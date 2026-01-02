// src/tools/dispatcher.ts
//
// Central tool dispatcher for v1.
//
// Responsibilities (v1):
// - Provide a single place to route tool calls to per-tool handlers.
// - Keep `src/mcp/handler.ts` focused on JSON-RPC + lifecycle + header enforcement.
// - Normalize successful tool outputs into MCP ToolCallResult envelopes.
// - Surface tool/validation/gating/provider errors as JSON-RPC errors (JsonRpcErrorObject).
//
// Notes:
// - Ajv input validation runs here (single validation path).
// - Handlers assume validated inputs and perform tool-specific gating/normalization.

import type { JsonRpcErrorObject } from '../mcp/jsonrpc.js';
import {
  buildV1ToolCatalog,
  isV1ToolName,
  type ToolCatalogEntry,
  type V1ToolName,
} from './catalog.js';
import type { SchemaRegistry } from './schemaRegistry.js';
import {
  createCacheWriteGuard,
  type CacheWriteGuard,
  type ToolRuntime,
} from './runtime/toolRuntime.js';
import { stableJsonStringify } from '../util/stableStringify.js';

// Handlers
import { handleDefinition, type DefinitionInput } from './handlers/definition.js';
import { handleReferences, type ReferencesInput } from './handlers/references.js';
import { handleHover, type HoverInput } from './handlers/hover.js';
import { handleDocumentSymbols, type DocumentSymbolsInput } from './handlers/documentSymbols.js';
import { handleWorkspaceSymbols, type WorkspaceSymbolsInput } from './handlers/workspaceSymbols.js';
import {
  handleDiagnosticsDocument,
  type DiagnosticsDocumentInput,
} from './handlers/diagnosticsDocument.js';
import {
  handleDiagnosticsWorkspace,
  type DiagnosticsWorkspaceInput,
} from './handlers/diagnosticsWorkspace.js';

const ERROR_CODE_INVALID_PARAMS = 'MCP_LSP_GATEWAY/INVALID_PARAMS' as const;
const ERROR_CODE_CAP_EXCEEDED = 'MCP_LSP_GATEWAY/CAP_EXCEEDED' as const;
const MAX_PAGE_SIZE = 200;
const MAX_CONTENT_SUMMARY_CHARS = 200;

export type ToolsListResult = Readonly<{ tools: readonly ToolCatalogEntry[] }>;

export type ToolCallTextContent = Readonly<{
  type: 'text';
  text: string;
}>;

/**
 * MCP ToolCallResult envelope (minimal shape used in v1).
 * `structuredContent` holds the tool-specific output object on success.
 */
export type ToolCallResult = Readonly<{
  isError: boolean;
  structuredContent: unknown;
  content: readonly ToolCallTextContent[];
}>;

export type DispatchResult =
  | Readonly<{ ok: true; result: ToolCallResult }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type ToolsDispatcherDeps = Readonly<{
  schemaRegistry: SchemaRegistry;
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
  maxItemsPerPage: number;
  requestTimeoutMs: number;
  toolRuntime: ToolRuntime;
  cacheWriteGuard?: CacheWriteGuard;
}>;

type HandlerResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type RoutedHandler = (args: unknown, deps: ToolsDispatcherDeps) => Promise<HandlerResult>;

const ROUTES: Readonly<Record<V1ToolName, RoutedHandler>> = {
  'vscode.lsp.definition': async (args, deps) => {
    return await handleDefinition(args as DefinitionInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.references': async (args, deps) => {
    return await handleReferences(args as ReferencesInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      maxItemsPerPage: deps.maxItemsPerPage,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.hover': async (args, deps) => {
    return await handleHover(args as HoverInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.documentSymbols': async (args, deps) => {
    return await handleDocumentSymbols(args as DocumentSymbolsInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.workspaceSymbols': async (args, deps) => {
    return await handleWorkspaceSymbols(args as WorkspaceSymbolsInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      maxItemsPerPage: deps.maxItemsPerPage,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.diagnostics.document': async (args, deps) => {
    return await handleDiagnosticsDocument(args as DiagnosticsDocumentInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      toolRuntime: deps.toolRuntime,
    });
  },

  'vscode.lsp.diagnostics.workspace': async (args, deps) => {
    return await handleDiagnosticsWorkspace(args as DiagnosticsWorkspaceInput, {
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
      maxItemsPerPage: deps.maxItemsPerPage,
      toolRuntime: deps.toolRuntime,
    });
  },
} as const;

export function dispatchToolsList(schemaRegistry: SchemaRegistry): ToolsListResult {
  const tools = buildV1ToolCatalog(
    (name) => schemaRegistry.getInputSchema(name),
    (name) => schemaRegistry.getOutputSchema(name),
  );
  return { tools };
}

export async function dispatchToolCall(
  toolName: string,
  args: unknown,
  deps: ToolsDispatcherDeps,
): Promise<DispatchResult> {
  // Unknown tool name: deterministic INVALID_PARAMS (not provider unavailable).
  if (!isV1ToolName(toolName)) {
    return { ok: false, error: invalidParamsUnknownTool(toolName) };
  }

  const validated = deps.schemaRegistry.validateInput(toolName, args);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const handler = ROUTES[toolName];
  // Defensive: should be impossible if ROUTES covers V1ToolName.
  if (!handler) {
    return { ok: false, error: invalidParamsUnknownTool(toolName) };
  }

  const normalizedArgs = normalizeValidatedArgs(validated.value, deps.maxItemsPerPage);
  const callKey = `${toolName}:${stableJsonStringify(normalizedArgs)}`;
  const { guard, expire } = createCacheWriteGuard();
  const raced = await deps.toolRuntime.singleflight(callKey, () =>
    withTimeout(
      handler(normalizedArgs, { ...deps, cacheWriteGuard: guard }),
      deps.requestTimeoutMs,
      expire,
    ),
  );
  if (raced.timedOut) {
    return { ok: false, error: capExceededError('Request timed out.') };
  }

  const r = raced.value;

  if (!r.ok) {
    // Tool-level errors are surfaced as JSON-RPC errors (per Step 8 contract).
    return { ok: false, error: r.error };
  }

  return { ok: true, result: toToolCallResult(r.result) };
}

function toToolCallResult(structuredContent: unknown): ToolCallResult {
  const summary = extractSummary(structuredContent);
  const text = summary ?? 'OK';

  return {
    isError: false,
    structuredContent,
    content: [{ type: 'text', text }],
  } as const;
}

function extractSummary(v: unknown): string | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const summary = (v as Record<string, unknown>).summary;
  if (typeof summary !== 'string') return undefined;
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > MAX_CONTENT_SUMMARY_CHARS
    ? normalized.slice(0, MAX_CONTENT_SUMMARY_CHARS)
    : normalized;
}

type TimeoutResult<T> = Readonly<{ timedOut: true }> | Readonly<{ timedOut: false; value: T }>;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<TimeoutResult<T>> {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 1;
  let timeoutId: NodeJS.Timeout | undefined;

  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      resolve({ timedOut: true });
    }, safeTimeoutMs);
  });

  const raced = Promise.race([
    promise.then((value) => ({ timedOut: false as const, value })),
    timeout,
  ]);
  try {
    return await raced;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeValidatedArgs(value: unknown, maxItemsPerPage: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const rec = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(rec, 'pageSize')) return value;

  const pageSize = rec.pageSize;
  if (typeof pageSize !== 'number' || !Number.isInteger(pageSize)) return value;

  const maxPageSize = clampMaxItemsPerPage(maxItemsPerPage);
  const clamped = clampInt(pageSize, 1, maxPageSize);
  if (clamped === pageSize) return value;

  return { ...rec, pageSize: clamped };
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

function capExceededError(message: string): JsonRpcErrorObject {
  const data: Record<string, unknown> = { code: ERROR_CODE_CAP_EXCEEDED };
  const trimmed = message.trim();
  if (trimmed.length > 0) data.message = trimmed;
  return {
    code: -32603,
    message: 'Internal error',
    data,
  };
}

function invalidParamsUnknownTool(tool: string): JsonRpcErrorObject {
  const safeTool = normalizeToolName(tool);
  return {
    code: -32602,
    message: 'Invalid params',
    data: {
      code: ERROR_CODE_INVALID_PARAMS,
      ...(safeTool ? { tool: safeTool } : undefined),
    },
  };
}

function normalizeToolName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (s.length === 0) return undefined;
  return s.length > 200 ? s.slice(0, 200) : s;
}
