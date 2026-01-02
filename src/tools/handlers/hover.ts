// src/tools/handlers/hover.ts
//
// vscode.lsp.hover (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Executes VS Code's hover provider and normalizes contents deterministically
// - Stable range selection and deterministic content ordering

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import { canonicalizeAndGateFileUri, type WorkspaceGateErrorCode } from '../../workspace/uri.js';
import { stableJsonStringify } from '../../util/stableStringify.js';
import { allowCacheWrite, type CacheWriteGuard, type ToolRuntime } from '../runtime/toolRuntime.js';

const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
type HoverContent = Readonly<{ kind: 'markdown' | 'plaintext'; value: string }>;
type HoverLike = Readonly<{ contents: unknown; range?: unknown }>;

export type HoverInput = Readonly<{
  uri: string;
  position: Readonly<{ line: number; character: number }>;
}>;

export type ToolResult =
  | Readonly<{ ok: true; result: HoverOutput }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type HoverOutput = Readonly<{
  contents: readonly HoverContent[];
  range?: ContractRange;
  summary?: string;
}>;

export type HoverDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  toolRuntime: ToolRuntime;
  cacheWriteGuard?: CacheWriteGuard;
}>;

export async function handleHover(args: HoverInput, deps: HoverDeps): Promise<ToolResult> {
  const gated = await canonicalizeAndGateFileUri(args.uri, deps.allowedRootsRealpaths).catch(
    () => ({
      ok: false as const,
      code: 'MCP_LSP_GATEWAY/URI_INVALID' as const,
    }),
  );

  if (!gated.ok) return { ok: false, error: gateError(gated.code) };

  const docUri = vscode.Uri.parse(gated.value.uri, true);
  const doc = await openOrReuseTextDocument(docUri).catch(() => undefined);
  if (!doc) {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/NOT_FOUND') };
  }

  const cacheKey = stableJsonStringify({
    tool: 'vscode.lsp.hover',
    uri: gated.value.uri,
    v: doc.version,
    line: args.position.line,
    character: args.position.character,
  });
  const cache = deps.toolRuntime.getUnpagedCache('vscode.lsp.hover');
  const cached = cache.get(cacheKey) as HoverOutput | undefined;
  if (cached) return { ok: true, result: cached };

  let raw: unknown;
  try {
    raw = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(args.position.line, args.position.character),
    );
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const hovers = normalizeHoverArray(raw);
  const contents = normalizeHoverContents(hovers);
  const range = pickStableRange(hovers);

  const summary = contents.length > 0 ? 'Hover available.' : 'No hover available.';
  const result: HoverOutput = {
    contents,
    ...(range ? { range } : undefined),
    summary,
  };

  if (allowCacheWrite(deps.cacheWriteGuard)) {
    cache.set(cacheKey, result);
  }
  return { ok: true, result };
}

function gateError(code: WorkspaceGateErrorCode): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code },
  };
}

function toolError(
  jsonRpcCode: number,
  code: string,
  message?: string,
  details?: Record<string, unknown>,
): JsonRpcErrorObject {
  const data: Record<string, unknown> = { code };
  if (typeof message === 'string' && message.trim().length > 0) data.message = message.trim();
  if (details && Object.keys(details).length > 0) data.details = details;

  return {
    code: jsonRpcCode,
    message: jsonRpcCode === E_INVALID_PARAMS ? 'Invalid params' : 'Internal error',
    data,
  };
}

async function openOrReuseTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const asString = uri.toString();
  const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === asString);
  if (existing) return existing;
  return await vscode.workspace.openTextDocument(uri);
}

function normalizeHoverArray(raw: unknown): HoverLike[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(isHoverLike);
  }
  return isHoverLike(raw) ? [raw] : [];
}

export function normalizeHoverContents(hovers: readonly HoverLike[]): HoverContent[] {
  const out: HoverContent[] = [];
  for (const hover of hovers) {
    const items = normalizeToArray(hover.contents);
    for (const item of items) {
      const normalized = normalizeHoverContentItem(item);
      if (normalized) out.push(normalized);
    }
  }

  return dedupeSortedHoverContents(sortHoverContents(out));
}

function normalizeHoverContentItem(item: unknown): HoverContent | undefined {
  if (item instanceof vscode.MarkdownString) {
    return { kind: 'markdown', value: String(item.value ?? '') };
  }

  if (typeof item === 'string') {
    return { kind: 'markdown', value: item };
  }

  if (isMarkupContent(item)) {
    return { kind: item.kind === 'plaintext' ? 'plaintext' : 'markdown', value: item.value };
  }

  if (isMarkedStringObject(item)) {
    return { kind: 'markdown', value: formatMarkedString(item.language, item.value) };
  }

  return undefined;
}

function isMarkupContent(
  item: unknown,
): item is Readonly<{ kind: 'markdown' | 'plaintext'; value: string }> {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  if (rec.kind !== 'markdown' && rec.kind !== 'plaintext') return false;
  return typeof rec.value === 'string';
}

function isMarkedStringObject(
  item: unknown,
): item is Readonly<{ language: string; value: string }> {
  if (!item || typeof item !== 'object') return false;
  const rec = item as Record<string, unknown>;
  return typeof rec.language === 'string' && typeof rec.value === 'string';
}

function formatMarkedString(language: string, value: string): string {
  const lang = language.trim();
  if (!lang) return value;
  return `\`\`\`${lang}\n${value}\n\`\`\``;
}

function sortHoverContents(contents: HoverContent[]): HoverContent[] {
  return contents.slice().sort(compareHoverContents);
}

function compareHoverContents(a: HoverContent, b: HoverContent): number {
  if (a.kind !== b.kind) return compareString(a.kind, b.kind);
  return compareString(a.value, b.value);
}

function compareString(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function normalizeToArray(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

export function pickStableRange(hovers: readonly HoverLike[]): ContractRange | undefined {
  let best: ContractRange | undefined;
  for (const hover of hovers) {
    if (!(hover.range instanceof vscode.Range)) continue;
    const candidate = toContractRange(hover.range);
    if (!best || compareRange(candidate, best) < 0) best = candidate;
  }
  return best;
}

function toContractRange(range: vscode.Range): ContractRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

function compareRange(a: ContractRange, b: ContractRange): number {
  const start = comparePosition(a.start, b.start);
  if (start !== 0) return start;
  return comparePosition(a.end, b.end);
}

function comparePosition(a: ContractPosition, b: ContractPosition): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

function isHoverLike(value: unknown): value is HoverLike {
  if (!value || typeof value !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(value, 'contents');
}

function dedupeSortedHoverContents(contents: HoverContent[]): HoverContent[] {
  const out: HoverContent[] = [];
  let prev: HoverContent | undefined;
  for (const item of contents) {
    if (prev && item.kind === prev.kind && item.value === prev.value) continue;
    out.push(item);
    prev = item;
  }
  return out;
}
