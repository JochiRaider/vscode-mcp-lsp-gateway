// src/tools/handlers/diagnosticsWorkspace.ts
//
// vscode_lsp_diagnostics_workspace (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - Canonicalize and filter URIs to allowed roots
// - Normalize diagnostics per file deterministically (sort/dedupe/cap)
// - Cursor-based paging by file groups with deterministic rejection on mismatch

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import { canonicalizeFileUri, isRealPathAllowed } from '../../workspace/uri.js';
import { allowCacheWrite, type CacheWriteGuard, type ToolRuntime } from '../runtime/toolRuntime.js';
import {
  computeRequestKey,
  computeSnapshotKey,
  cursorExpiredError,
  paginate,
  snapshotTooLargeError,
  validateCursor,
} from '../paging/cursor.js';
import { enforceDiagnosticsCap, normalizeDiagnostics } from './diagnosticsDocument.js';

const TOOL_NAME = 'vscode_lsp_diagnostics_workspace' as const;
const MAX_WORKSPACE_DIAGNOSTICS_ITEMS_TOTAL = 5000;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;

const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
type ContractDiagnostic = Readonly<{
  id: string;
  range: ContractRange;
  severity?: number;
  code?: string;
  source?: string;
  message: string;
}>;

export type DiagnosticsWorkspaceInput = Readonly<{
  cursor?: string | null;
  pageSize?: number;
}>;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type DiagnosticsWorkspaceDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  maxItemsPerPage: number;
  toolRuntime: ToolRuntime;
  cacheWriteGuard?: CacheWriteGuard;
}>;

export async function handleDiagnosticsWorkspace(
  args: DiagnosticsWorkspaceInput,
  deps: DiagnosticsWorkspaceDeps,
): Promise<ToolResult> {
  const requestKey = computeRequestKey(TOOL_NAME, []);
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
    | readonly FileDiagnosticsGroup[]
    | undefined;

  let groups: readonly FileDiagnosticsGroup[];
  if (hasCursor) {
    if (!cached) return { ok: false, error: cursorExpiredError() };
    groups = cached;
  } else if (cached) {
    groups = cached;
  } else {
    const computed = await deps.toolRuntime.singleflight(snapshotKey, async () => {
      let raw: unknown;
      try {
        raw = vscode.languages.getDiagnostics();
      } catch {
        return { ok: false as const, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/INTERNAL') };
      }

      const normalized = await normalizeWorkspaceDiagnosticsGroups(raw, deps.allowedRootsRealpaths);

      const capError = checkWorkspaceDiagnosticsTotalCap(normalized.groups.length);
      if (capError) return { ok: false as const, error: capError };

      const nextGroups = normalized.groups;
      if (allowCacheWrite(deps.cacheWriteGuard)) {
        const stored = deps.toolRuntime.pagedFullSetCache.set(snapshotKey, nextGroups);
        if (!stored.stored) return { ok: false as const, error: snapshotTooLargeError() };
      }

      return { ok: true as const, value: nextGroups };
    });

    if (!computed.ok) return { ok: false, error: computed.error };
    groups = computed.value;
  }

  const paged = paginate(groups, pageSize, args.cursor ?? null, requestKey, snapshotKey);
  if (!paged.ok) return { ok: false, error: paged.error };

  const items = paged.items.map(stripGroupCapped);
  const anyCapped = paged.items.some((group) => group.capped);

  const summary = formatSummary(items.length, paged.nextCursor !== null, anyCapped);

  return {
    ok: true,
    result: {
      items,
      nextCursor: paged.nextCursor,
      summary,
    },
  };
}

type FileDiagnosticsGroup = Readonly<{
  uri: string;
  diagnostics: readonly ContractDiagnostic[];
  capped: boolean;
}>;

type NormalizedGroups = Readonly<{
  groups: readonly FileDiagnosticsGroup[];
}>;

type CanonicalizeResult = Awaited<ReturnType<typeof canonicalizeFileUri>>;
type CanonicalizeFn = (uri: string) => Promise<CanonicalizeResult>;

export async function normalizeWorkspaceDiagnosticsGroups(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
  canonicalize: CanonicalizeFn = canonicalizeFileUri,
): Promise<NormalizedGroups> {
  const byUri = new Map<string, unknown[]>();
  const entries = Array.isArray(raw) ? raw : [];

  for (const entry of entries) {
    if (!isDiagnosticsTuple(entry)) continue;
    const [uri, diagnostics] = entry;

    let canon: CanonicalizeResult;
    try {
      canon = await canonicalize(uri.toString());
    } catch {
      continue;
    }
    if (!canon.ok) continue;
    if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) continue;

    const existing = byUri.get(canon.value.uri);
    if (existing) {
      existing.push(...diagnostics);
    } else {
      byUri.set(canon.value.uri, diagnostics.slice());
    }
  }

  const groups: FileDiagnosticsGroup[] = [];
  for (const [uri, diagnostics] of byUri.entries()) {
    const normalized = normalizeDiagnostics(diagnostics, uri);
    const enforced = enforceDiagnosticsCap(normalized);
    if (enforced.items.length === 0) continue;
    groups.push({ uri, diagnostics: enforced.items, capped: enforced.capped });
  }

  groups.sort(compareGroupsByUri);
  return { groups };
}

export function checkWorkspaceDiagnosticsTotalCap(count: number): JsonRpcErrorObject | undefined {
  if (count > MAX_WORKSPACE_DIAGNOSTICS_ITEMS_TOTAL) {
    return capExceededError('Workspace diagnostics exceeded max total.');
  }
  return undefined;
}

function compareGroupsByUri(a: FileDiagnosticsGroup, b: FileDiagnosticsGroup): number {
  if (a.uri === b.uri) return 0;
  return a.uri < b.uri ? -1 : 1;
}

function isDiagnosticsTuple(value: unknown): value is readonly [vscode.Uri, unknown[]] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const tuple = value as unknown[];
  const uri = tuple[0];
  const diagnostics = tuple[1];
  if (!(uri instanceof vscode.Uri)) return false;
  if (!Array.isArray(diagnostics)) return false;
  return true;
}

function stripGroupCapped(group: FileDiagnosticsGroup): Readonly<{
  uri: string;
  diagnostics: readonly ContractDiagnostic[];
}> {
  return { uri: group.uri, diagnostics: group.diagnostics };
}

function formatSummary(count: number, hasNextPage: boolean, anyCapped: boolean): string {
  const base =
    count === 1 ? 'Returned diagnostics for 1 file' : `Returned diagnostics for ${count} files`;
  const notes: string[] = [];
  if (hasNextPage) notes.push('next page available');
  if (anyCapped) notes.push('Capped');
  return notes.length > 0 ? `${base} (${notes.join('; ')}).` : `${base}.`;
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
    message: jsonRpcCode === -32602 ? 'Invalid params' : 'Internal error',
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
