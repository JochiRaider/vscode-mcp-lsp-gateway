// src/tools/catalog.ts
//
// v1 tool catalog (single source of truth):
// - Stable, ordered tool names per docs/CONTRACT.md
// - Stable descriptions
// - readOnlyHint annotations (always true in v1)
// - inputSchema is provided as an object at runtime (e.g., from schemaRegistry)

export const V1_TOOL_NAMES = [
  "vscode.lsp.definition",
  "vscode.lsp.references",
  "vscode.lsp.hover",
  "vscode.lsp.documentSymbols",
  "vscode.lsp.workspaceSymbols",
  "vscode.lsp.diagnostics.document",
  "vscode.lsp.diagnostics.workspace",
] as const;

export type V1ToolName = (typeof V1_TOOL_NAMES)[number];

export type JsonSchemaObject = Readonly<Record<string, unknown>>;

export type ToolCatalogEntry = Readonly<{
  name: V1ToolName;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: Readonly<{ readOnlyHint: true }>;
}>;

const DESCRIPTIONS: Readonly<Record<V1ToolName, string>> = {
  "vscode.lsp.definition": "Find definition location(s) for a symbol at a position.",
  "vscode.lsp.references": "Find reference locations for a symbol at a position (paged).",
  "vscode.lsp.hover": "Return hover information at a position.",
  "vscode.lsp.documentSymbols": "Return flattened document symbols for a file.",
  "vscode.lsp.workspaceSymbols": "Search workspace symbols by query string (paged).",
  "vscode.lsp.diagnostics.document": "Return diagnostics for a single document.",
  "vscode.lsp.diagnostics.workspace": "Return diagnostics across the workspace (paged by file).",
} as const;

export function isV1ToolName(name: string): name is V1ToolName {
  return (V1_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Build the v1 tool catalog with runtime schema objects (no $ref strings).
 *
 * `getInputSchema` must return the already-loaded JSON schema object for the given tool name.
 * This keeps tool metadata centralized while allowing schemaRegistry to own schema IO + Ajv compilation.
 */
export function buildV1ToolCatalog(getInputSchema: (name: V1ToolName) => JsonSchemaObject): readonly ToolCatalogEntry[] {
  // Explicit construction preserves stable ordering (no object key iteration).
  return V1_TOOL_NAMES.map((name) => {
    const inputSchema = getInputSchema(name);
    return {
      name,
      description: DESCRIPTIONS[name],
      inputSchema,
      annotations: { readOnlyHint: true },
    } as const;
  });
}
