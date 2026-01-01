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
import type { ToolRuntime } from '../runtime/toolRuntime.js';
import { stableIdFromCanonicalString } from '../ids.js';
import { canonicalDedupeKey, compareWorkspaceSymbols, dedupeSortedByKey } from '../sorting.js';
import {
  computeRequestKey,
  computeSnapshotKey,
  cursorExpiredError,
  paginate,
  snapshotTooLargeError,
  validateCursor,
} from '../paging/cursor.js';

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
  toolRuntime: ToolRuntime;
}>;

type CanonicalizeResult = Awaited<ReturnType<typeof canonicalizeFileUri>>;
type CanonicalizeFn = (uriString: string) => Promise<CanonicalizeResult>;

export async function handleWorkspaceSymbols(
  args: WorkspaceSymbolsInput,
  deps: WorkspaceSymbolsDeps,
): Promise<ToolResult> {
  const normalizedQuery = normalizeWorkspaceSymbolsQuery(args.query);
  if (normalizedQuery.length === 0) {
    return {
      ok: false,
      error: toolError(E_INVALID_PARAMS, 'MCP_LSP_GATEWAY/INVALID_PARAMS'),
    };
  }
  const requestKey = computeRequestKey(TOOL_NAME, [normalizedQuery]);
  const epochTupleString = deps.toolRuntime.getSnapshotFingerprint(
    TOOL_NAME,
    deps.allowedRootsRealpaths,
  );
  const snapshotKey = computeSnapshotKey(requestKey, epochTupleString);
  const cursorChecked = validateCursor(args.cursor, requestKey, snapshotKey);
  if (!cursorChecked.ok) return { ok: false, error: cursorChecked.error };
  const hasCursor = typeof args.cursor === 'string';

  const pageSize = clampPageSize(args.pageSize, deps.maxItemsPerPage);

  const cached = deps.toolRuntime.pagedFullSetCache.get(snapshotKey) as
    | readonly ContractWorkspaceSymbol[]
    | undefined;

  let deduped: readonly ContractWorkspaceSymbol[];
  if (hasCursor) {
    if (!cached) return { ok: false, error: cursorExpiredError() };
    deduped = cached;
  } else if (cached) {
    deduped = cached;
  } else {
    const computed = await deps.toolRuntime.singleflight(snapshotKey, async () => {
      let raw: unknown;
      try {
        raw = await vscode.commands.executeCommand(
          'vscode.executeWorkspaceSymbolProvider',
          normalizedQuery,
        );
      } catch {
        return {
          ok: false as const,
          error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE'),
        };
      }

      const normalized = await normalizeWorkspaceSymbols(raw, deps.allowedRootsRealpaths);
      normalized.sort(compareWorkspaceSymbols);
      const nextDeduped = dedupeSortedByKey(normalized, canonicalDedupeKey);

      const capError = checkWorkspaceSymbolsTotalCap(nextDeduped.length);
      if (capError) return { ok: false as const, error: capError };

      const stored = deps.toolRuntime.pagedFullSetCache.set(snapshotKey, nextDeduped);
      if (!stored.stored) return { ok: false as const, error: snapshotTooLargeError() };

      return { ok: true as const, value: nextDeduped };
    });

    if (!computed.ok) return { ok: false, error: computed.error };
    deduped = computed.value;
  }

  const paged = paginate(deduped, pageSize, args.cursor ?? null, requestKey, snapshotKey);
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

export async function normalizeWorkspaceSymbols(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
  canonicalize: CanonicalizeFn = canonicalizeFileUri,
): Promise<ContractWorkspaceSymbol[]> {
  const out: ContractWorkspaceSymbol[] = [];
  const canonicalizeCached = createCanonicalizeCache(canonicalize);
  const items = normalizeToArray(raw);
  for (const item of items) {
    const symbol = await normalizeOneSymbol(item, allowedRootsRealpaths, canonicalizeCached);
    if (symbol) out.push(symbol);
  }
  return out;
}

async function normalizeOneSymbol(
  item: unknown,
  allowedRootsRealpaths: readonly string[],
  canonicalize: CanonicalizeFn,
): Promise<ContractWorkspaceSymbol | undefined> {
  if (!item || typeof item !== 'object') return undefined;
  const rec = item as Record<string, unknown>;

  const name = rec.name;
  const kind = rec.kind;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (typeof kind !== 'number' || !Number.isInteger(kind) || kind < 0) return undefined;

  const location = pickLocationLike(rec.location);
  if (!location) return undefined;

  const loc = await canonicalizeAndFilterLocation(
    location.uri,
    location.range,
    allowedRootsRealpaths,
    canonicalize,
  );
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
  uri: vscode.Uri,
  range: vscode.Range,
  allowedRootsRealpaths: readonly string[],
  canonicalize: CanonicalizeFn,
): Promise<ContractLocation | undefined> {
  const uriString = safeUriString(uri);
  if (!uriString) return undefined;

  const canon = await canonicalize(uriString);
  if (!canon.ok) return undefined;
  if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) return undefined;

  const contractRange = toContractRange(range);
  if (!contractRange) return undefined;

  return {
    uri: canon.value.uri,
    range: contractRange,
  };
}

function toContractRange(r: vscode.Range): ContractRange | undefined {
  const start = toContractPosition(r.start);
  const end = toContractPosition(r.end);
  if (!start || !end) return undefined;
  return { start, end };
}

function toContractPosition(pos: vscode.Position): ContractPosition | undefined {
  const line = pos.line;
  const character = pos.character;
  if (!Number.isInteger(line) || line < 0) return undefined;
  if (!Number.isInteger(character) || character < 0) return undefined;
  return { line, character };
}

function rangeKey(pos: ContractPosition): string {
  return `${pos.line}:${pos.character}`;
}

function normalizeToArray(raw: unknown): unknown[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

type LocationLike = Readonly<{ uri: vscode.Uri; range: vscode.Range }>;

function pickLocationLike(value: unknown): LocationLike | undefined {
  if (value instanceof vscode.Location) {
    return { uri: value.uri, range: value.range };
  }
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const uri = rec.uri;
  const range = rec.range;
  if (uri instanceof vscode.Uri && range instanceof vscode.Range) {
    return { uri, range };
  }
  return undefined;
}

function safeUriString(uri: vscode.Uri): string | undefined {
  try {
    const s = uri.toString();
    return typeof s === 'string' && s.length > 0 ? s : undefined;
  } catch {
    return undefined;
  }
}

function createCanonicalizeCache(canonicalize: CanonicalizeFn): CanonicalizeFn {
  const cache = new Map<string, Promise<CanonicalizeResult>>();
  return (uriString) => {
    const key = uriString;
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = canonicalize(key);
    cache.set(key, pending);
    return pending;
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
