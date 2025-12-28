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
// - Individual handlers may currently perform Ajv validation and URI gating themselves (as your stubs do).
//   This dispatcher is compatible with that pattern.
// - If you later refactor handlers to assume validated/gated input, move Ajv + gating here and
//   simplify handlers accordingly.

import type { JsonRpcErrorObject } from "../mcp/jsonrpc.js";
import { buildV1ToolCatalog, isV1ToolName, type ToolCatalogEntry, type V1ToolName } from "./catalog.js";
import type { SchemaRegistry } from "./schemaRegistry.js";

// Handlers
import { handleDefinition } from "./handlers/definition.js";
import type { DefinitionInput } from "./handlers/definition.js";
import { handleReferences } from "./handlers/references.js";
import { handleHover } from "./handlers/hover.js";
import { handleDocumentSymbols } from "./handlers/documentSymbols.js";
import { handleWorkspaceSymbols } from "./handlers/workspaceSymbols.js";
import { handleDiagnosticsDocument } from "./handlers/diagnosticsDocument.js";
import { handleDiagnosticsWorkspace } from "./handlers/diagnosticsWorkspace.js";

const ERROR_CODE_INVALID_PARAMS = "MCP_LSP_GATEWAY/INVALID_PARAMS" as const;

export type ToolsListResult = Readonly<{ tools: readonly ToolCatalogEntry[] }>;

export type ToolCallTextContent = Readonly<{
  type: "text";
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
}>;

type HandlerResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

type RoutedHandler = (args: unknown, deps: ToolsDispatcherDeps) => Promise<HandlerResult>;

const ROUTES: Readonly<Record<V1ToolName, RoutedHandler>> = {
  "vscode.lsp.definition": async (args, deps) => {
    // Definition handler expects a typed input; it also does defensive validation internally.
    return await handleDefinition(args as DefinitionInput, { allowedRootsRealpaths: deps.allowedRootsRealpaths });
  },

  "vscode.lsp.references": async (args, deps) => {
    return await handleReferences(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },

  "vscode.lsp.hover": async (args, deps) => {
    return await handleHover(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },

  "vscode.lsp.documentSymbols": async (args, deps) => {
    return await handleDocumentSymbols(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },

  "vscode.lsp.workspaceSymbols": async (args, deps) => {
    return await handleWorkspaceSymbols(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },

  "vscode.lsp.diagnostics.document": async (args, deps) => {
    return await handleDiagnosticsDocument(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },

  "vscode.lsp.diagnostics.workspace": async (args, deps) => {
    return await handleDiagnosticsWorkspace(args, {
      schemaRegistry: deps.schemaRegistry,
      allowedRootsRealpaths: deps.allowedRootsRealpaths,
    });
  },
} as const;

export function dispatchToolsList(schemaRegistry: SchemaRegistry): ToolsListResult {
  const tools = buildV1ToolCatalog((name) => schemaRegistry.getInputSchema(name));
  return { tools };
}

export async function dispatchToolCall(toolName: string, args: unknown, deps: ToolsDispatcherDeps): Promise<DispatchResult> {
  // Unknown tool name: deterministic INVALID_PARAMS (not provider unavailable).
  if (!isV1ToolName(toolName)) {
    return { ok: false, error: invalidParamsUnknownTool(toolName) };
  }

  const handler = ROUTES[toolName];
  // Defensive: should be impossible if ROUTES covers V1ToolName.
  if (!handler) {
    return { ok: false, error: invalidParamsUnknownTool(toolName) };
  }

  const r = await handler(args, deps);

  if (!r.ok) {
    // Tool-level errors are surfaced as JSON-RPC errors (per Step 8 contract).
    return { ok: false, error: r.error };
  }

  return { ok: true, result: toToolCallResult(r.result) };
}

function toToolCallResult(structuredContent: unknown): ToolCallResult {
  const text = safeStableJson(structuredContent);

  return {
    isError: false,
    structuredContent,
    content: [{ type: "text", text }],
  } as const;
}

function safeStableJson(v: unknown): string {
  try {
    // Deterministic for plain objects/arrays constructed deterministically by handlers.
    return JSON.stringify(v);
  } catch {
    // Fail-closed and bounded: do not throw from dispatcher.
    return JSON.stringify({
      ok: false,
      error: { code: "MCP_LSP_GATEWAY/INTERNAL_ERROR", message: "Failed to serialize tool result." },
    });
  }
}

function invalidParamsUnknownTool(tool: string): JsonRpcErrorObject {
  const safeTool = normalizeToolName(tool);
  return {
    code: -32602,
    message: "Invalid params",
    data: {
      code: ERROR_CODE_INVALID_PARAMS,
      ...(safeTool ? { tool: safeTool } : undefined),
    },
  };
}

function normalizeToolName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length === 0) return undefined;
  return s.length > 200 ? s.slice(0, 200) : s;
}
