// src/tools/handlers/definition.ts
//
// vscode.lsp.definition (v1)
// - Opens (or reuses) the target document.
// - Executes VS Code's definition provider.
// - Normalizes Location + LocationLink into contract Location objects.
// - Filters outputs to allowed roots (realpath-gated).
// - Canonicalizes output URIs (file: only, realpath-based).
// - Stable sort + deterministic dedupe.
// - Enforces MAX_ITEMS_NONPAGED via deterministic truncation.

import * as vscode from 'vscode';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import {
  canonicalizeAndGateFileUri,
  canonicalizeFileUri,
  isRealPathAllowed,
} from '../../workspace/uri.js';
import { canonicalDedupeKey, compareLocations, dedupeSortedByKey } from '../sorting.js';

const MAX_ITEMS_NONPAGED = 200;

const E_INVALID_PARAMS = -32602;
const E_INTERNAL = -32603;

type ContractPosition = Readonly<{ line: number; character: number }>;
type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
export type ContractLocation = Readonly<{ uri: string; range: ContractRange }>;

export type DefinitionInput = Readonly<{
  uri: string;
  position: Readonly<{ line: number; character: number }>;
}>;

export type DefinitionOutput = Readonly<{
  locations: readonly ContractLocation[];
  summary?: string;
}>;

export type ToolResult =
  | Readonly<{ ok: true; result: DefinitionOutput }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type DefinitionDeps = Readonly<{
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
}>;

export async function handleDefinition(
  input: DefinitionInput,
  deps: DefinitionDeps,
): Promise<ToolResult> {
  // Gate + canonicalize input URI (fail closed).
  const gated = await canonicalizeAndGateFileUri(input.uri, deps.allowedRootsRealpaths);
  if (!gated.ok) {
    return {
      ok: false,
      error: toolError(E_INVALID_PARAMS, gated.code),
    };
  }

  const docUri = vscode.Uri.parse(gated.value.uri, true);

  // Open document (reuse if already open).
  const doc = await openOrReuseTextDocument(docUri).catch(() => undefined);
  if (!doc) {
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/NOT_FOUND') };
  }

  // Execute provider command.
  let raw: unknown;
  try {
    raw = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      doc.uri,
      new vscode.Position(input.position.line, input.position.character),
    );
  } catch {
    // Avoid leaking provider / filesystem details.
    return { ok: false, error: toolError(E_INTERNAL, 'MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE') };
  }

  const normalized = await normalizeDefinitionResult(raw, deps.allowedRootsRealpaths);

  // Stable sort + deterministic dedupe (per contract ordering rules).
  normalized.sort(compareLocations);
  const deduped = dedupeSortedByKey(normalized, canonicalDedupeKey);

  // Enforce MAX_ITEMS_NONPAGED via deterministic truncation (keep first N after canonical sort).
  const truncated =
    deduped.length > MAX_ITEMS_NONPAGED ? deduped.slice(0, MAX_ITEMS_NONPAGED) : deduped;

  const summary =
    truncated.length === 1
      ? 'Found 1 definition.'
      : `Found ${truncated.length} definitions.${deduped.length > MAX_ITEMS_NONPAGED ? ' (Capped.)' : ''}`;

  return { ok: true, result: { locations: truncated, summary } };
}

async function openOrReuseTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const asString = uri.toString();
  const existing = vscode.workspace.textDocuments.find((d) => d.uri.toString() === asString);
  if (existing) return existing;
  return await vscode.workspace.openTextDocument(uri);
}

async function normalizeDefinitionResult(
  raw: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation[]> {
  const out: ContractLocation[] = [];

  const items = normalizeToArray(raw);
  for (const item of items) {
    const loc = await normalizeOneLocationLike(item, allowedRootsRealpaths);
    if (loc) out.push(loc);
  }

  return out;
}

async function normalizeOneLocationLike(
  item: unknown,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractLocation | undefined> {
  if (!item || typeof item !== 'object') return undefined;

  // LocationLink
  if (isLocationLink(item)) {
    const targetUri = item.targetUri;
    const range = item.targetSelectionRange ?? item.targetRange;
    return await canonicalizeAndFilterLocation(targetUri, range, allowedRootsRealpaths);
  }

  // Location
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
  // Canonicalize output URI (realpath-based), then filter to allowed roots.
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
