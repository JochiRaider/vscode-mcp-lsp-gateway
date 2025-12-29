// src/tools/handlers/diagnosticsDocument.ts
//
// vscode.lsp.diagnostics.document (v1)
// - Ajv input validation via SchemaRegistry (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Normalizes diagnostics to contract shape with stable ids, sort, dedupe
// - Enforces MAX_ITEMS_NONPAGED via deterministic truncation

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import type { SchemaRegistry } from '../schemaRegistry.js';
import { stableIdFromCanonicalString } from '../ids.js';
import {
  canonicalDedupeKey,
  compareDiagnostics,
  dedupeSortedByKey,
  type ContractRange,
} from '../sorting.js';
import { canonicalizeAndGateFileUri, type WorkspaceGateErrorCode } from '../../workspace/uri.js';

const TOOL_NAME = 'vscode.lsp.diagnostics.document' as const;
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

export type ToolResult =
  | Readonly<{ ok: true; result: DiagnosticsDocumentOutput }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type DiagnosticsDocumentOutput = Readonly<{
  uri: string;
  diagnostics: readonly ContractDiagnostic[];
  summary?: string;
}>;

export type DiagnosticsDocumentDeps = Readonly<{
  schemaRegistry: SchemaRegistry;
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
}>;

export async function handleDiagnosticsDocument(
  args: unknown,
  deps: DiagnosticsDocumentDeps,
): Promise<ToolResult> {
  const validated = deps.schemaRegistry.validateInput(TOOL_NAME, args);
  if (!validated.ok) return { ok: false, error: validated.error };

  const v = validated.value as Readonly<{ uri: string }>;

  const gated = await canonicalizeAndGateFileUri(v.uri, deps.allowedRootsRealpaths).catch(() => ({
    ok: false as const,
    code: 'MCP_LSP_GATEWAY/URI_INVALID' as const,
  }));

  if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };

  const docUri = vscode.Uri.parse(gated.value.uri, true);

  let raw: vscode.Diagnostic[];
  try {
    raw = vscode.languages.getDiagnostics(docUri);
  } catch {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const normalized = normalizeDiagnostics(raw, gated.value.uri);
  const enforced = enforceDiagnosticsCap(normalized);

  const summary =
    enforced.items.length === 1
      ? 'Returned 1 diagnostic.'
      : `Returned ${enforced.items.length} diagnostics.${enforced.capped ? ' (Capped.)' : ''}`;

  return {
    ok: true,
    result: {
      uri: gated.value.uri,
      diagnostics: enforced.items,
      summary,
    },
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

type SortableDiagnostic = ContractDiagnostic & Readonly<{ uri: string }>;

export function normalizeDiagnostics(
  diagnostics: readonly vscode.Diagnostic[],
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

function normalizeDiagnostic(
  diag: vscode.Diagnostic,
  canonicalUri: string,
): SortableDiagnostic | undefined {
  if (!diag || !(diag.range instanceof vscode.Range)) return undefined;
  if (typeof diag.message !== 'string' || diag.message.length === 0) return undefined;

  const range = toContractRange(diag.range);
  const severity = normalizeSeverity(diag.severity);
  const code = normalizeDiagnosticCode(diag.code);
  const source = normalizeOptionalString(diag.source);

  const canonicalString = buildDiagnosticCanonicalString(
    canonicalUri,
    range,
    severity,
    code,
    source,
    diag.message,
  );

  return {
    uri: canonicalUri,
    id: stableIdFromCanonicalString(canonicalString),
    range,
    ...(severity !== undefined ? { severity } : undefined),
    ...(code ? { code } : undefined),
    ...(source ? { source } : undefined),
    message: diag.message,
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
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
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

function toContractRange(r: vscode.Range): ContractRange {
  return {
    start: { line: r.start.line, character: r.start.character },
    end: { line: r.end.line, character: r.end.character },
  };
}

function rangeKey(pos: ContractPosition): string {
  return `${pos.line}:${pos.character}`;
}
