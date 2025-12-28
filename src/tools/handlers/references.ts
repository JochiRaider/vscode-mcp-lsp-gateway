// src/tools/handlers/references.ts
//
// vscode.lsp.references (v1) — stub
// - Ajv input validation via SchemaRegistry (deterministic -32602 on failure)
// - URI gating (schema includes `uri`)
// - Always returns deterministic PROVIDER_UNAVAILABLE until implemented

import type { JsonRpcErrorObject } from "../../mcp/jsonrpc";
import type { SchemaRegistry } from "../schemaRegistry";
import { canonicalizeAndGateFileUri, type WorkspaceGateErrorCode } from "../../workspace/uri";
import { unimplementedToolError } from "./_unimplemented";

const TOOL_NAME = "vscode.lsp.references" as const;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type ReferencesDeps = Readonly<{
  schemaRegistry: SchemaRegistry;
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
}>;

export async function handleReferences(args: unknown, deps: ReferencesDeps): Promise<ToolResult> {
  const validated = deps.schemaRegistry.validateInput(TOOL_NAME, args);
  if (!validated.ok) return { ok: false, error: validated.error };

  const v = validated.value as Readonly<{ uri: string }>;

  const gated = await canonicalizeAndGateFileUri(v.uri, deps.allowedRootsRealpaths).catch(
    () => ({ ok: false as const, code: "MCP_LSP_GATEWAY/URI_INVALID" as const }),
  );

  if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };

  return { ok: false, error: unimplementedToolError({ tool: TOOL_NAME }) };
}

function invalidParamsError(code: WorkspaceGateErrorCode): JsonRpcErrorObject {
  return {
    code: -32602,
    message: "Invalid params",
    data: { code },
  };
}
