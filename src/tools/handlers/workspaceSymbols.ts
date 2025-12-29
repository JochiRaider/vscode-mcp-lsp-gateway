// src/tools/handlers/workspaceSymbols.ts
//
// vscode.lsp.workspaceSymbols (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - Normalize query, execute VS Code workspace symbol provider
// - Canonicalize output URIs and filter to allowed roots
// - Stable sort + deterministic dedupe + total-set cap enforcement
// - Cursor-based paging with deterministic rejection on mismatch

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import { canonicalizeFileUri, isRealPathAllowed } from '../../workspace/uri.js';
import { stableIdFromCanonicalString } from '../ids.js';
import { canonicalDedupeKey, compareWorkspaceSymbols, dedupeSortedByKey } from '../sorting.js';
import { computeRequestKey, paginate, validateCursor } from '../paging/cursor.js';

const TOOL_NAME = 'vscode.lsp.workspaceSymbols' as const;
const MAX_WORKSPACE_SYMBOLS_ITEMS_TOTAL = 20000;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
type ContractLocation = Readonly<{ uri: string; range: ContractRange }>;
type ContractWorkspaceSymbol = Readonly<{
  id: string;
  name: string;
  kind: number;
  location: ContractLocation;
  containerName?: string;
}>;

export type WorkspaceSymbolsInput = Readonly<{
  query: string;
  cursor?: string | null;
  pageSize?: number;
}>;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type WorkspaceSymbolsDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  maxItemsPerPage: number;
}>;

export async function handleWorkspaceSymbols(
  args: WorkspaceSymbolsInput,
  deps: WorkspaceSymbolsDeps,
): Promise<ToolResult> {
  const normalizedQuery = normalizeWorkspaceSymbolsQuery(args.query);
  const requestKey = computeRequestKey(TOOL_NAME, [normalizedQuery]);
  const cursorChecked = validateCursor(args.cursor, requestKey);
  if (!cursorChecked.ok) return { ok: false, error: cursorChecked.error };

  const pageSize = clampPageSize(args.pageSize, deps.maxItemsPerPage);

  let raw: unknown;
  try {
    raw = await vscode.commands.executeCommand(
      'vscode.executeWorkspaceSymbolProvider',
      normalizedQuery,
    );
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const normalized = await normalizeWorkspaceSymbols(raw, deps.allowedRootsRealpaths);
  normalized.sort(compareWorkspaceSymbols);
  const deduped = dedupeSortedByKey(normalized, canonicalDedupeKey);

  const capError = checkWorkspaceSymbolsTotalCap(deduped.length);
  if (capError) return { ok: false, error: capError };

  const paged = paginate(deduped, pageSize, args.cursor ?? null, requestKey);
  if (!paged.ok) return { ok: false, error: paged.error };

  const summary =
    paged.items.length === 1
      ? 'Returned 1 workspace symbol.'
      : `Returned ${paged.items.length} workspace symbols${
          paged.nextCursor ? ' (next page available).' : '.'
        }`;

  return {
    ok: true,
    result: {
      items: paged.items,
      nextCursor: paged.nextCursor,
      summary,
    },
  };
}

export function normalizeWorkspaceSymbolsQuery(query: string): string {
  return String(query ?? '').trim();
}

export function checkWorkspaceSymbolsTotalCap(count: number): JsonRpcErrorObject | undefined {
  if (count > MAX_WORKSPACE_SYMBOLS_ITEMS_TOTAL) {
    return capExceededError('Workspace symbols exceeded max total.');
  }
  return undefined;
}

async function normalizeWorkspaceSymbols(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractWorkspaceSymbol[]> {
  const out: ContractWorkspaceSymbol[] = [];
  const items = normalizeToArray(raw);
  for (const item of items) {
    const symbol = await normalizeOneSymbol(item, allowedRootsRealpaths);
    if (symbol) out.push(symbol);
  }
  return out;
}

async function normalizeOneSymbol(
  item: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractWorkspaceSymbol | undefined> {
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;

  const name = rec.name;
  const kind = rec.kind;
  const location = rec.location;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0) return undefined;
  if (!(location instanceof vscode.Location)) return undefined;

  const loc = await canonicalizeAndFilterLocation(location, allowedRootsRealpaths);
  if (!loc) return undefined;

  const containerName =
    typeof rec.containerName === 'string' && rec.containerName.length > 0
      ? rec.containerName
      : undefined;

  const canonicalString = [
    loc.uri,
    name,
    kind,
    rangeKey(loc.range.start),
    rangeKey(loc.range.end),
    containerName ?? '',
  ].join('|');

  return {
    id: stableIdFromCanonicalString(canonicalString),
    name,
    kind,
    location: loc,
    ...(containerName ? { containerName } : undefined),
  };
}

async function canonicalizeAndFilterLocation(
  location: vscode.Location,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation | undefined> {
  const canon = await canonicalizeFileUri(location.uri.toString());
  if (!canon.ok) return undefined;
  if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) return undefined;

  return {
    uri: canon.value.uri,
    range: toContractRange(location.range),
  };
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
