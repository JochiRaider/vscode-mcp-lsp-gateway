// src/tools/handlers/_unimplemented.ts
//
// Deterministic helper for v1 tools that are cataloged but not implemented yet.
//
// Contract goals:
// - Stable JSON-RPC error object shape
// - Non-sensitive message (no paths, no secrets, no raw payload echo)
// - error.data.code is always MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE
//
// Note: In normal operation, Ajv/schema validation should fail earlier with -32602,
// so callers typically use the default (-32603). This helper supports -32602 when
// the caller needs an explicit invalid-params code.

import type { JsonRpcErrorObject } from "../../mcp/jsonrpc.js";

export const ERROR_CODE_PROVIDER_UNAVAILABLE = "MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE" as const;

const JSONRPC_INVALID_PARAMS = -32602 as const;
const JSONRPC_INTERNAL_ERROR = -32603 as const;

export type UnimplementedToolErrorOptions = Readonly<{
  /**
   * Optional stable tool identifier for diagnostics (safe to return).
   * This MUST NOT include filesystem paths or other sensitive data.
   */
  tool?: string;

  /**
   * If true, emit JSON-RPC -32602; otherwise emit -32603.
   * `error.data.code` remains PROVIDER_UNAVAILABLE either way.
   */
  invalidParams?: boolean;
}>;

export function unimplementedToolError(opts: UnimplementedToolErrorOptions = {}): JsonRpcErrorObject {
  const jsonRpcCode = opts.invalidParams ? JSONRPC_INVALID_PARAMS : JSONRPC_INTERNAL_ERROR;

  const data: Record<string, unknown> = {
    code: ERROR_CODE_PROVIDER_UNAVAILABLE,
    // Stable, non-sensitive message intended for clients/humans.
    message: "Provider unavailable.",
  };

  const tool = normalizeToolName(opts.tool);
  if (tool) data.tool = tool;

  return {
    code: jsonRpcCode,
    message: jsonRpcCode === JSONRPC_INVALID_PARAMS ? "Invalid params" : "Internal error",
    data,
  };
}

function normalizeToolName(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length === 0) return undefined;
  // Bound to keep responses/logs deterministic and small.
  return s.length > 200 ? s.slice(0, 200) : s;
}
