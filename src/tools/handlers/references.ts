// src/tools/handlers/references.ts
//
// vscode.lsp.references (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Executes VS Code's reference provider and normalizes to contract Location[]
// - Stable sort + deterministic dedupe + total-set cap enforcement
// - Cursor-based paging with deterministic rejection on mismatch

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import {
  canonicalizeAndGateFileUri,
  canonicalizeFileUri,
  isRealPathAllowed,
  type WorkspaceGateErrorCode,
} from '../../workspace/uri.js';
import { canonicalDedupeKey, compareLocations, dedupeSortedByKey } from '../sorting.js';
import { computeRequestKey, paginate, validateCursor } from '../paging/cursor.js';

const TOOL_NAME = 'vscode.lsp.references' as const;
const MAX_REFERENCES_ITEMS_TOTAL = 20000;
export const MAX_REFERENCES_ITEMS_RAW = MAX_REFERENCES_ITEMS_TOTAL * 4;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
type ContractLocation = Readonly<{ uri: string; range: ContractRange }>;

export type ReferencesInput = Readonly<{
  uri: string;
  position: Readonly<{ line: number; character: number }>;
  includeDeclaration?: boolean;
  cursor?: string | null;
  pageSize?: number;
}>;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type ReferencesDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  maxItemsPerPage: number;
}>;

export async function handleReferences(
  args: ReferencesInput,
  deps: ReferencesDeps,
): Promise<ToolResult> {
  const gated = await canonicalizeAndGateFileUri(args.uri, deps.allowedRootsRealpaths).catch(
    () => ({
      ok: false as const,
      code: 'MCP_LSP_GATEWAY/URI_INVALID' as const,
    }),
  );

  if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };

  const includeDeclaration = args.includeDeclaration === true;
  const requestKey = computeRequestKey(TOOL_NAME, [
    gated.value.uri,
    args.position.line,
    args.position.character,
    includeDeclaration,
  ]);
  const cursorChecked = validateCursor(args.cursor, requestKey);
  if (!cursorChecked.ok) return { ok: false, error: cursorChecked.error };

  const pageSize = clampPageSize(args.pageSize, deps.maxItemsPerPage);
  const docUri = vscode.Uri.parse(gated.value.uri, true);
  const doc = await openOrReuseTextDocument(docUri).catch(() => undefined);
  if (!doc) return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/NOT_FOUND') };

  let raw: unknown;
  try {
    raw = await vscode.commands.executeCommand(
      'vscode.executeReferenceProvider',
      doc.uri,
      new vscode.Position(args.position.line, args.position.character),
      includeDeclaration,
    );
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const rawCapError = checkReferencesRawCap(raw);
  if (rawCapError) return { ok: false, error: rawCapError };

  const normalized = await normalizeReferenceResult(raw, deps.allowedRootsRealpaths);
  normalized.sort(compareLocations);
  const deduped = dedupeSortedByKey(normalized, canonicalDedupeKey);

  const capError = checkReferencesTotalCap(deduped.length);
  if (capError) return { ok: false, error: capError };

  const paged = paginate(deduped, pageSize, args.cursor ?? null, requestKey);
  if (!paged.ok) return { ok: false, error: paged.error };

  const summary =
    paged.items.length === 1
      ? 'Returned 1 reference.'
      : `Returned ${paged.items.length} references${paged.nextCursor ? ' (next page available).' : '.'}`;

  return {
    ok: true,
    result: {
      items: paged.items,
      nextCursor: paged.nextCursor,
      summary,
    },
  };
}

export function checkReferencesTotalCap(count: number): JsonRpcErrorObject | undefined {
  if (count > MAX_REFERENCES_ITEMS_TOTAL) {
    return capExceededError('References exceeded max total.');
  }
  return undefined;
}

export function checkReferencesRawCap(raw: unknown): JsonRpcErrorObject | undefined {
  if (Array.isArray(raw) && raw.length > MAX_REFERENCES_ITEMS_RAW) {
    return capExceededError('References exceeded max total.');
  }
  return undefined;
}

async function openOrReuseTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const asString = uri.toString();
  const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === asString);
  if (existing) return existing;
  return await vscode.workspace.openTextDocument(uri);
}

export async function normalizeReferenceResult(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation[]> {
  const out: ContractLocation[] = [];
  const items = normalizeToArray(raw);
  for (const item of items) {
    try {
      const loc = await normalizeOneLocationLike(item, allowedRootsRealpaths);
      if (loc) out.push(loc);
    } catch {
      // Fail closed: drop invalid items deterministically.
      continue;
    }
  }
  return out;
}

async function normalizeOneLocationLike(
  item: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation | undefined> {
  if (!item || typeof item !== 'object') return undefined;

  if (isLocationLink(item)) {
    const targetUri = item.targetUri;
    const range = pickLocationLinkRange(item);
    if (!range) return undefined;
    return await canonicalizeAndFilterLocation(targetUri, range, allowedRootsRealpaths);
  }

  if (isLocation(item)) {
    return await canonicalizeAndFilterLocation(item.uri, item.range, allowedRootsRealpaths);
  }

  return undefined;
}

async function canonicalizeAndFilterLocation(
  uri: vscode.Uri,
  range: vscode.Range,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation | undefined> {
  const canon = await canonicalizeFileUri(uri.toString());
  if (!canon.ok) return undefined;
  if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) return undefined;

  return {
    uri: canon.value.uri,
    range: toContractRange(range),
  };
}

function toContractRange(r: vscode.Range): ContractRange {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function normalizeToArray(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function isLocation(v: unknown): v is vscode.Location {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.uri instanceof vscode.Uri && o.range instanceof vscode.Range;
}

function isLocationLink(v: unknown): v is vscode.LocationLink {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return o.targetUri instanceof vscode.Uri && o.targetRange instanceof vscode.Range;
}

function pickLocationLinkRange(link: vscode.LocationLink): vscode.Range | undefined {
  if (link.targetSelectionRange instanceof vscode.Range) return link.targetSelectionRange;
  if (link.targetRange instanceof vscode.Range) return link.targetRange;
  return undefined;
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

function capExceededError(message: string): JsonRpcErrorObject {
  const data: Record<string, unknown> = { code: 'MCP_LSP_GATEWAY/CAP_EXCEEDED' };
  const trimmed = message.trim();
  if (trimmed.length > 0) data.message = trimmed;
  return {
    code: -32603,
    message: 'Internal error',
    data,
  };
}

function clampPageSize(value: number | undefined, maxItemsPerPage: number): number {
  const maxPageSize = clampMaxItemsPerPage(maxItemsPerPage);
  const raw = typeof value === 'number' && Number.isInteger(value) ? value : DEFAULT_PAGE_SIZE;
  return clampInt(raw, 1, maxPageSize);
}

function clampMaxItemsPerPage(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return MAX_PAGE_SIZE;
  if (value < 1) return 1;
  if (value > MAX_PAGE_SIZE) return MAX_PAGE_SIZE;
  return value;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
