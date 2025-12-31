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
export const MAX_SYMBOL_NODES_VISITED = 20000;

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
  if (!normalized.ok) return { ok: false, error: normalized.error };

  normalized.items.sort(compareDocumentSymbols);
  const deduped = dedupeSortedByKey(normalized.items, canonicalDedupeKey);

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

export type NormalizeDocumentSymbolsResult =
  | Readonly<{ ok: true; items: ContractDocumentSymbol[] }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type TraversalState = { visited: number; exceeded: boolean };

export async function normalizeDocumentSymbolsResult(
  raw: unknown,
  canonicalUri: string,
  allowedRootsRealpaths: readonly string[],
  maxNodesVisited: number = MAX_SYMBOL_NODES_VISITED,
): Promise<NormalizeDocumentSymbolsResult> {
  const out: ContractDocumentSymbol[] = [];
  const docSymbols: vscode.DocumentSymbol[] = [];
  const symbolInfos: vscode.SymbolInformation[] = [];
  const items = normalizeToArray(raw);
  for (const item of items) {
    if (item instanceof vscode.DocumentSymbol) {
      docSymbols.push(item);
    } else if (item instanceof vscode.SymbolInformation) {
      symbolInfos.push(item);
    }
  }

  const state = createTraversalState();

  if (docSymbols.length > 0) {
    out.push(
      ...flattenDocumentSymbols(docSymbols, canonicalUri, undefined, state, maxNodesVisited),
    );
  }

  if (state.exceeded) {
    return { ok: false, error: capExceededError('Document symbols exceeded max total.') };
  }

  for (const symbolInfo of symbolInfos) {
    if (state.visited >= maxNodesVisited) {
      state.exceeded = true;
      break;
    }
    state.visited++;
    const symbol = await normalizeSymbolInformation(symbolInfo, allowedRootsRealpaths);
    if (symbol) out.push(symbol);
  }

  if (state.exceeded) {
    return { ok: false, error: capExceededError('Document symbols exceeded max total.') };
  }

  return { ok: true, items: out };
}

export function flattenDocumentSymbols(
  symbols: readonly vscode.DocumentSymbol[],
  canonicalUri: string,
  containerName: string | undefined,
  state: TraversalState = createTraversalState(),
  maxNodesVisited: number = MAX_SYMBOL_NODES_VISITED,
): ContractDocumentSymbol[] {
  const out: ContractDocumentSymbol[] = [];
  const sorted = symbols.slice().sort(compareDocumentSymbolNodes);

  for (const sym of sorted) {
    if (state.visited >= maxNodesVisited) {
      state.exceeded = true;
      break;
    }
    state.visited++;

    const name = normalizeSymbolName(sym.name);
    const range = toContractRange(sym.range);
    const selectionRange = toContractRange(sym.selectionRange);
    const container = containerName && containerName.length > 0 ? containerName : undefined;

    if (name) {
      const canonicalString = [
        canonicalUri,
        name,
        sym.kind,
        rangeKey(range.start),
        rangeKey(range.end),
        rangeKey(selectionRange.start),
        rangeKey(selectionRange.end),
        container ?? '',
      ].join('|');

      out.push({
        id: stableIdFromCanonicalString(canonicalString),
        name,
        kind: sym.kind,
        range,
        selectionRange,
        ...(container ? { containerName: container } : undefined),
      });
    }

    if (Array.isArray(sym.children) && sym.children.length > 0) {
      const nextContainer = name ?? undefined;
      out.push(
        ...flattenDocumentSymbols(
          sym.children,
          canonicalUri,
          nextContainer,
          state,
          maxNodesVisited,
        ),
      );
      if (state.exceeded) break;
    }
  }

  return out;
}

export async function normalizeSymbolInformation(
  symbol: vscode.SymbolInformation,
  allowedRootsRealpaths: readonly string[],
): Promise<ContractDocumentSymbol | undefined> {
  const name = normalizeSymbolName(symbol.name);
  if (!name) return undefined;

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
    name,
    symbol.kind,
    rangeKey(range.start),
    rangeKey(range.end),
    rangeKey(selectionRange.start),
    rangeKey(selectionRange.end),
    container ?? '',
  ].join('|');

  return {
    id: stableIdFromCanonicalString(canonicalString),
    name,
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
  const start = toContractPosition(r.start);
  const end = toContractPosition(r.end);
  return normalizeRange(start, end);
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

function createTraversalState(): TraversalState {
  return { visited: 0, exceeded: false };
}

function normalizeSymbolName(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  if (name.trim().length === 0) return undefined;
  return name;
}

function toContractPosition(pos: vscode.Position): ContractPosition {
  return {
    line: clampPositionValue(pos.line),
    character: clampPositionValue(pos.character),
  };
}

function clampPositionValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const int = Math.floor(value);
  return int < 0 ? 0 : int;
}

function normalizeRange(start: ContractPosition, end: ContractPosition): ContractRange {
  return comparePosition(start, end) <= 0 ? { start, end } : { start: end, end: start };
}

function comparePosition(a: ContractPosition, b: ContractPosition): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

function invalidParamsError(code: WorkspaceGateErrorCode): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code },
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
