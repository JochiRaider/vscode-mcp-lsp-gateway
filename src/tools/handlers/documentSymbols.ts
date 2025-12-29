// src/tools/handlers/documentSymbols.ts
//
// vscode.lsp.documentSymbols (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Executes VS Code's document symbol provider and normalizes to flattened output
// - Stable sort + deterministic dedupe
// - Enforces MAX_ITEMS_NONPAGED via deterministic truncation

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import {
  canonicalizeAndGateFileUri,
  canonicalizeFileUri,
  isRealPathAllowed,
  type WorkspaceGateErrorCode,
} from '../../workspace/uri.js';
import { stableIdFromCanonicalString } from '../ids.js';
import { canonicalDedupeKey, compareDocumentSymbols, dedupeSortedByKey } from '../sorting.js';

export const MAX_ITEMS_NONPAGED = 200;

const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
type ContractDocumentSymbol = Readonly<{
  id: string;
  name: string;
  kind: number;
  range: ContractRange;
  selectionRange: ContractRange;
  containerName?: string;
}>;

export type DocumentSymbolsInput = Readonly<{ uri: string }>;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type DocumentSymbolsDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
}>;

export async function handleDocumentSymbols(
  args: DocumentSymbolsInput,
  deps: DocumentSymbolsDeps,
): Promise<ToolResult> {
  const gated = await canonicalizeAndGateFileUri(args.uri, deps.allowedRootsRealpaths).catch(
    () => ({
      ok: false as const,
      code: 'MCP_LSP_GATEWAY/URI_INVALID' as const,
    }),
  );

  if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };

  const docUri = vscode.Uri.parse(gated.value.uri, true);
  const doc = await openOrReuseTextDocument(docUri).catch(() => undefined);
  if (!doc) return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/NOT_FOUND') };

  let raw: unknown;
  try {
    raw = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', doc.uri);
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const normalized = await normalizeDocumentSymbolsResult(
    raw,
    gated.value.uri,
    deps.allowedRootsRealpaths,
  );
  normalized.sort(compareDocumentSymbols);
  const deduped = dedupeSortedByKey(normalized, canonicalDedupeKey);

  const enforced = enforceDocumentSymbolsCap(deduped);
  const summary =
    enforced.items.length === 1
      ? 'Returned 1 document symbol.'
      : `Returned ${enforced.items.length} document symbols${enforced.capped ? ' (Capped.)' : '.'}`;

  return { ok: true, result: { symbols: enforced.items, summary } };
}

export function enforceDocumentSymbolsCap(
  symbols: readonly ContractDocumentSymbol[],
): Readonly<{ items: readonly ContractDocumentSymbol[]; capped: boolean }> {
  if (symbols.length > MAX_ITEMS_NONPAGED) {
    return { items: symbols.slice(0, MAX_ITEMS_NONPAGED), capped: true };
  }
  return { items: symbols, capped: false };
}

async function openOrReuseTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const asString = uri.toString();
  const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === asString);
  if (existing) return existing;
  return await vscode.workspace.openTextDocument(uri);
}

async function normalizeDocumentSymbolsResult(
  raw: unknown,
  canonicalUri: string,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractDocumentSymbol[]> {
  const out: ContractDocumentSymbol[] = [];
  const items = normalizeToArray(raw);
  for (const item of items) {
    if (item instanceof vscode.DocumentSymbol) {
      out.push(...flattenDocumentSymbols([item], canonicalUri, undefined));
      continue;
    }
    if (item instanceof vscode.SymbolInformation) {
      const symbol = await normalizeSymbolInformation(item, allowedRootsRealpaths);
      if (symbol) out.push(symbol);
      continue;
    }
  }
  return out;
}

export function flattenDocumentSymbols(
  symbols: readonly vscode.DocumentSymbol[],
  canonicalUri: string,
  containerName: string | undefined,
): ContractDocumentSymbol[] {
  const out: ContractDocumentSymbol[] = [];
  const sorted = symbols.slice().sort(compareDocumentSymbolNodes);

  for (const sym of sorted) {
    const range = toContractRange(sym.range);
    const selectionRange = toContractRange(sym.selectionRange);
    const container = containerName && containerName.length > 0 ? containerName : undefined;
    const canonicalString = [
      canonicalUri,
      sym.name,
      sym.kind,
      rangeKey(range.start),
      rangeKey(range.end),
      rangeKey(selectionRange.start),
      rangeKey(selectionRange.end),
      container ?? '',
    ].join('|');

    out.push({
      id: stableIdFromCanonicalString(canonicalString),
      name: sym.name,
      kind: sym.kind,
      range,
      selectionRange,
      ...(container ? { containerName: container } : undefined),
    });

    if (Array.isArray(sym.children) && sym.children.length > 0) {
      out.push(...flattenDocumentSymbols(sym.children, canonicalUri, sym.name));
    }
  }

  return out;
}

export async function normalizeSymbolInformation(
  symbol: vscode.SymbolInformation,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractDocumentSymbol | undefined> {
  const loc = await canonicalizeAndFilterLocation(symbol.location, allowedRootsRealpaths);
  if (!loc) return undefined;

  const range = loc.range;
  const selectionRange = range;
  const container =
    typeof symbol.containerName === 'string' && symbol.containerName.length > 0
      ? symbol.containerName
      : undefined;
  const canonicalString = [
    loc.uri,
    symbol.name,
    symbol.kind,
    rangeKey(range.start),
    rangeKey(range.end),
    rangeKey(selectionRange.start),
    rangeKey(selectionRange.end),
    container ?? '',
  ].join('|');

  return {
    id: stableIdFromCanonicalString(canonicalString),
    name: symbol.name,
    kind: symbol.kind,
    range,
    selectionRange,
    ...(container ? { containerName: container } : undefined),
  };
}

async function canonicalizeAndFilterLocation(
  location: vscode.Location,
  allowedRootsRealpaths: readonly string[],
): Promise<Readonly<{ uri: string; range: ContractRange }> | undefined> {
  const canon = await canonicalizeFileUri(location.uri.toString());
  if (!canon.ok) return undefined;
  if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) return undefined;
  return { uri: canon.value.uri, range: toContractRange(location.range) };
}

function toContractRange(r: vscode.Range): ContractRange {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function rangeKey(pos: ContractPosition): string {
  return `${pos.line}:${pos.character}`;
}

function normalizeToArray(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function compareDocumentSymbolNodes(a: vscode.DocumentSymbol, b: vscode.DocumentSymbol): number {
  const ar = a.range;
  const br = b.range;
  if (ar.start.line !== br.start.line) return ar.start.line - br.start.line;
  if (ar.start.character !== br.start.character) return ar.start.character - br.start.character;
  if (ar.end.line !== br.end.line) return ar.end.line - br.end.line;
  if (ar.end.character !== br.end.character) return ar.end.character - br.end.character;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.kind !== b.kind) return a.kind - b.kind;
  return 0;
}

function invalidParamsError(code: WorkspaceGateErrorCode): JsonRpcErrorObject {
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
