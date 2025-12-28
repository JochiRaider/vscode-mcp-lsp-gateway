// src/tools/handlers/workspaceSymbols.ts
//
// vscode.lsp.workspaceSymbols (v1) — stub
// - Ajv input validation via SchemaRegistry (deterministic -32602 on failure)
// - URI gating only if (and only if) the validated args include a top-level `uri` field
//   (this tool’s v1 schema should NOT, but this keeps the stub generic and future-proof)
// - Always returns deterministic PROVIDER_UNAVAILABLE until implemented

import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import type { SchemaRegistry } from '../schemaRegistry.js';
import { canonicalizeAndGateFileUri, type WorkspaceGateErrorCode } from '../../workspace/uri.js';
import { unimplementedToolError } from './_unimplemented.js';

const TOOL_NAME = 'vscode.lsp.workspaceSymbols' as const;

export type ToolResult =
  | Readonly<{ ok: true; result: unknown }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type WorkspaceSymbolsDeps = Readonly<{
  schemaRegistry: SchemaRegistry;
  /** Canonical realpaths of allowlisted roots (workspace folders + additional roots). */
  allowedRootsRealpaths: readonly string[];
}>;

export async function handleWorkspaceSymbols(
  args: unknown,
  deps: WorkspaceSymbolsDeps,
): Promise<ToolResult> {
  const validated = deps.schemaRegistry.validateInput(TOOL_NAME, args);
  if (!validated.ok) return { ok: false, error: validated.error };

  // Apply URI gating only when schema allows a top-level `uri` (Ajv would otherwise reject it).
  const v = validated.value as Record<string, unknown>;
  const uriRaw = v['uri'];
  if (typeof uriRaw === 'string') {
    const gated = await canonicalizeAndGateFileUri(uriRaw, deps.allowedRootsRealpaths);
    if (!gated.ok) return { ok: false, error: invalidParamsError(gated.code) };
  }

  return { ok: false, error: unimplementedToolError({ tool: TOOL_NAME }) };
}

function invalidParamsError(code: WorkspaceGateErrorCode): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code },
  };
}
