// src/tools/handlers/diagnosticsDocument.ts
//
// vscode_lsp_diagnostics_document (v1)
// - Input is already Ajv-validated by the dispatcher (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Normalizes diagnostics to contract shape with stable ids, sort, dedupe
// - Enforces MAX_ITEMS_NONPAGED via deterministic truncation

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import { stableIdFromCanonicalString } from '../ids.js';
import { stableJsonStringify } from '../../util/stableStringify.js';
import { allowCacheWrite, type CacheWriteGuard, type ToolRuntime } from '../runtime/toolRuntime.js';
import {
  canonicalDedupeKey,
  compareDiagnostics,
  dedupeSortedByKey,
  type ContractRange,
} from '../sorting.js';
import { canonicalizeAndGateFileUri, type WorkspaceGateErrorCode } from '../../workspace/uri.js';

export const MAX_ITEMS_NONPAGED = 200;
const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractDiagnostic = Readonly<{
  id: string;
  range: ContractRange;
  severity?: number;
  code?: string;
  source?: string;
  message: string;
}>;

export type DiagnosticsDocumentInput = Readonly<{ uri: string }>;

export type ToolResult =
  | Readonly<{ ok: true; result: DiagnosticsDocumentOutput }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type DiagnosticsDocumentOutput = Readonly<{
  uri: string;
  diagnostics: readonly ContractDiagnostic[];
  summary?: string;
}>;

export type DiagnosticsDocumentDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  toolRuntime: ToolRuntime;
  cacheWriteGuard?: CacheWriteGuard;
}>;

export async function handleDiagnosticsDocument(
  args: DiagnosticsDocumentInput,
  deps: DiagnosticsDocumentDeps,
): Promise<ToolResult> {
  const gated = await canonicalizeAndGateFileUri(args.uri, deps.allowedRootsRealpaths).catch(
    () => ({
      ok: false as const,
      code: 'MCP_LSP_GATEWAY/URI_INVALID' as const,
    }),
  );

  if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };

  const docUri = vscode.Uri.parse(gated.value.uri, true);
  const doc = findOpenTextDocument(docUri);
  const cacheKey = doc
    ? stableJsonStringify({
        tool: 'vscode_lsp_diagnostics_document',
        uri: gated.value.uri,
        v: doc.version,
      })
    : undefined;
  const cache = deps.toolRuntime.getUnpagedCache('vscode_lsp_diagnostics_document');
  const cached = cacheKey
    ? (cache.get(cacheKey) as DiagnosticsDocumentOutput | undefined)
    : undefined;
  if (cached) return { ok: true, result: cached };

  let raw: vscode.Diagnostic[];
  try {
    raw = vscode.languages.getDiagnostics(docUri);
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/INTERNAL') };
  }

  const normalized = normalizeDiagnostics(raw, gated.value.uri);
  const enforced = enforceDiagnosticsCap(normalized);

  const summary =
    enforced.items.length === 1
      ? 'Returned 1 diagnostic.'
      : `Returned ${enforced.items.length} diagnostics.${enforced.capped ? ' (Capped.)' : ''}`;

  const result: DiagnosticsDocumentOutput = {
    uri: gated.value.uri,
    diagnostics: enforced.items,
    summary,
  };
  if (cacheKey && allowCacheWrite(deps.cacheWriteGuard)) {
    cache.set(cacheKey, result);
  }

  return {
    ok: true,
    result,
  };
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

function findOpenTextDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const asString = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === asString);
}

type SortableDiagnostic = ContractDiagnostic & Readonly<{ uri: string }>;

export function normalizeDiagnostics(
  diagnostics: readonly unknown[],
  canonicalUri: string,
): ContractDiagnostic[] {
  const out: SortableDiagnostic[] = [];
  for (const diag of diagnostics) {
    const normalized = normalizeDiagnostic(diag, canonicalUri);
    if (normalized) out.push(normalized);
  }

  out.sort(compareDiagnostics);

  const withoutUri = out.map(stripUri);
  return dedupeSortedByKey(withoutUri, canonicalDedupeKey);
}

function normalizeDiagnostic(diag: unknown, canonicalUri: string): SortableDiagnostic | undefined {
  if (!diag || typeof diag !== 'object') return undefined;
  const rec = diag as Record<string, unknown>;

  const range = normalizeRangeLike(rec.range);
  const message = normalizeMessage(rec.message);
  if (!range || !message) return undefined;

  const severity = normalizeSeverity(rec.severity);
  const code = normalizeDiagnosticCode(rec.code);
  const source = normalizeOptionalString(rec.source);

  const canonicalString = buildDiagnosticCanonicalString(
    canonicalUri,
    range,
    severity,
    code,
    source,
    message,
  );

  return {
    uri: canonicalUri,
    id: stableIdFromCanonicalString(canonicalString),
    range,
    ...(severity !== undefined ? { severity } : undefined),
    ...(code ? { code } : undefined),
    ...(source ? { source } : undefined),
    message,
  };
}

function stripUri(item: SortableDiagnostic): ContractDiagnostic {
  return {
    id: item.id,
    range: item.range,
    ...(item.severity !== undefined ? { severity: item.severity } : undefined),
    ...(item.code ? { code: item.code } : undefined),
    ...(item.source ? { source: item.source } : undefined),
    message: item.message,
  };
}

export function buildDiagnosticCanonicalString(
  uri: string,
  range: ContractRange,
  severity: number | undefined,
  code: string | undefined,
  source: string | undefined,
  message: string,
): string {
  return [
    uri,
    rangeKey(range.start),
    rangeKey(range.end),
    severity ?? '',
    code ?? '',
    source ?? '',
    message,
  ].join('|');
}

export function enforceDiagnosticsCap(items: readonly ContractDiagnostic[]): Readonly<{
  items: ContractDiagnostic[];
  capped: boolean;
}> {
  if (items.length > MAX_ITEMS_NONPAGED) {
    return { items: items.slice(0, MAX_ITEMS_NONPAGED), capped: true };
  }
  return { items: items.slice(0), capped: false };
}

function normalizeSeverity(value: unknown): number | undefined {
  if (!isNonNegativeInt(value)) return undefined;
  return value;
}

function normalizeDiagnosticCode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.length > 0 ? value : undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    const str = String(value);
    return str.length > 0 ? str : undefined;
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, 'value')) return undefined;
    const inner = rec.value;
    if (typeof inner === 'string') return inner.length > 0 ? inner : undefined;
    if (typeof inner === 'number') {
      if (!Number.isFinite(inner)) return undefined;
      const str = String(inner);
      return str.length > 0 ? str : undefined;
    }
  }
  return undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function normalizeMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function normalizeRangeLike(value: unknown): ContractRange | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (value instanceof vscode.Range) return toContractRange(value);
  const rec = value as Record<string, unknown>;
  const start = normalizePositionLike(rec.start);
  const end = normalizePositionLike(rec.end);
  if (!start || !end) return undefined;
  return { start, end };
}

function normalizePositionLike(value: unknown): ContractPosition | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const line = rec.line;
  const character = rec.character;
  if (!isNonNegativeInt(line) || !isNonNegativeInt(character)) return undefined;
  return { line, character };
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
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
