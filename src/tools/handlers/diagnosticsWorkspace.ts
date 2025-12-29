// src/tools/handlers/diagnosticsWorkspace.ts
//
// vscode.lsp.diagnostics.workspace (v1)
// - Ajv input validation via SchemaRegistry (deterministic -32602 on failure)
// - Canonicalize and filter URIs to allowed roots
// - Normalize diagnostics per file deterministically (sort/dedupe/cap)
// - Cursor-based paging by file groups with deterministic rejection on mismatch

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import type { SchemaRegistry } from '../schemaRegistry.js';
import { canonicalizeFileUri, isRealPathAllowed } from '../../workspace/uri.js';
import { computeRequestKey, paginate, validateCursor } from '../paging/cursor.js';
import { enforceDiagnosticsCap, normalizeDiagnostics } from './diagnosticsDocument.js';

const TOOL_NAME = 'vscode.lsp.diagnostics.workspace' as const;
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

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type DiagnosticsWorkspaceDeps = Readonly<{
  schemaRegistry: SchemaRegistry;
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  maxItemsPerPage: number;
}>;

export async function handleDiagnosticsWorkspace(
  args: unknown,
  deps: DiagnosticsWorkspaceDeps,
): Promise<ToolResult> {
  const validated = deps.schemaRegistry.validateInput(TOOL_NAME, args);
  if (!validated.ok) return { ok: false, error: validated.error };

  const v = validated.value as Readonly<{ cursor?: string | null; pageSize?: number }>;
  const requestKey = computeRequestKey(TOOL_NAME, []);
  const cursorChecked = validateCursor(v.cursor, requestKey);
  if (!cursorChecked.ok) return { ok: false, error: cursorChecked.error };

  const pageSize = clampPageSize(v.pageSize, deps.maxItemsPerPage);

  let raw: unknown;
  try {
    raw = vscode.languages.getDiagnostics();
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const normalized = await normalizeWorkspaceDiagnosticsGroups(raw, deps.allowedRootsRealpaths);

  const capError = checkWorkspaceDiagnosticsTotalCap(normalized.groups.length);
  if (capError) return { ok: false, error: capError };

  const paged = paginate(normalized.groups, pageSize, v.cursor ?? null, requestKey);
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

export async function normalizeWorkspaceDiagnosticsGroups(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<NormalizedGroups> {
  const byUri = new Map<string, vscode.Diagnostic[]>();
  const entries = Array.isArray(raw) ? raw : [];

  for (const entry of entries) {
    if (!isDiagnosticsTuple(entry)) continue;
    const [uri, diagnostics] = entry;

    const canon = await canonicalizeFileUri(uri.toString());
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

function isDiagnosticsTuple(value: unknown): value is readonly [vscode.Uri, vscode.Diagnostic[]] {
  if (!Array.isArray(value) || value.length < 2) return false;
  const tuple = value as unknown[];
  const uri = tuple[0];
  const diagnostics = tuple[1];
  if (!(uri instanceof vscode.Uri)) return false;
  if (!Array.isArray(diagnostics)) return false;
  return diagnostics.every((diag) => diag instanceof vscode.Diagnostic);
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
