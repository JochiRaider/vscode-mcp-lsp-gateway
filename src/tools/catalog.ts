// src/tools/catalog.ts
//
// v1 tool catalog (single source of truth):
// - Stable, ordered tool names per docs/CONTRACT.md
// - Stable descriptions
// - readOnlyHint annotations (always true in v1)
// - inputSchema/outputSchema are provided as objects at runtime (e.g., from schemaRegistry)

export const V1_TOOL_NAMES = [
  'vscode_lsp_definition',
  'vscode_lsp_references',
  'vscode_lsp_hover',
  'vscode_lsp_documentSymbols',
  'vscode_lsp_workspaceSymbols',
  'vscode_lsp_diagnostics_document',
  'vscode_lsp_diagnostics_workspace',
] as const;

export type V1ToolName = (typeof V1_TOOL_NAMES)[number];

export type JsonSchemaObject = Readonly<Record<string, unknown>>;

export type ToolCatalogEntry = Readonly<{
  name: V1ToolName;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  annotations: Readonly<{ readOnlyHint: true }>;
}>;

const DESCRIPTIONS: Readonly<Record<V1ToolName, string>> = {
  vscode_lsp_definition: 'Find definition location(s) for a symbol at a position.',
  vscode_lsp_references: 'Find reference locations for a symbol at a position (paged).',
  vscode_lsp_hover: 'Return hover information at a position.',
  vscode_lsp_documentSymbols: 'Return flattened document symbols for a file.',
  vscode_lsp_workspaceSymbols: 'Search workspace symbols by query string (paged).',
  vscode_lsp_diagnostics_document: 'Return diagnostics for a single document.',
  vscode_lsp_diagnostics_workspace: 'Return diagnostics across the workspace (paged by file).',
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
export function buildV1ToolCatalog(
  getInputSchema: (name: V1ToolName) => JsonSchemaObject,
  getOutputSchema: (name: V1ToolName) => JsonSchemaObject,
): readonly ToolCatalogEntry[] {
  // Explicit construction preserves stable ordering (no object key iteration).
  return V1_TOOL_NAMES.map((name) => {
    const inputSchema = getInputSchema(name);
    const outputSchema = getOutputSchema(name);
    return {
      name,
      description: DESCRIPTIONS[name],
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    } as const;
  });
}
