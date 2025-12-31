# Repo Context (mcp-lsp-gateway)

## Scope

- This map reflects the repo tree provided in this prompt.
- Summaries use file contents only when available in this ChatGPT Project; otherwise TODO placeholders.

## Context by file

- `.gitattributes` — Git attributes enforce LF endings and mark common binary file types.
- `.gitignore` — Ignore dependencies, build outputs, caches, VS Code artifacts, and OS noise.
- `.prettierignore` — Prettier ignore list for build outputs, node_modules, coverage, and VSIX.
- `.prettierrc.json` — Prettier configuration with 100 width, single quotes, trailing commas, semicolons.
- `.vscodeignore` — VS Code extension packaging exclude list for sources and build artifacts.
- `AGENTS.md` — Contributor guide: contracts, security invariants, validation commands, and workflow expectations.
- `LICENSE` — MIT License granting broad permissions with warranty disclaimer and liability limits.
- `README.md` — Brief overview of the VS Code MCP LSP gateway extension.
- `docs/CONTRACT.md` — Authoritative v1 tool catalog, determinism rules, caps, and JSON-RPC error taxonomy.
- `docs/PROTOCOL.md` — Streamable HTTP transport contract: endpoint, headers, status codes, init lifecycle.
- `docs/SCHEMA.md` — Schema governance for v1 tools: dialect, layout, invariants, and change workflow.
- `docs/SECURITY.md` — Threat model and enforced controls for localhost-only, read-only MCP gateway.
- `docs/repo_map.md` — Auto-generated repository map with tree, counts, and notable anchors.
- `eslint.config.mjs` — ESLint flat configuration for TypeScript tests and sources with Prettier.
- `package-lock.json` — npm lockfile capturing resolved dependency versions and integrity hashes.
- `package.json` — VS Code extension manifest: commands, settings, scripts, and dependencies.
- `schemas/tools/vscode.lsp.definition.json` — Input JSON Schema for definition tool: file URI and 0-based position.
- `schemas/tools/vscode.lsp.definition.output.json` — Output schema for definitions: locations array plus optional summary text.
- `schemas/tools/vscode.lsp.diagnostics.document.json` — Input schema for document diagnostics: required file URI.
- `schemas/tools/vscode.lsp.diagnostics.document.output.json` — Output schema for document diagnostics: uri, diagnostics list, optional summary.
- `schemas/tools/vscode.lsp.diagnostics.workspace.json` — Input schema for workspace diagnostics paging: cursor and pageSize.
- `schemas/tools/vscode.lsp.diagnostics.workspace.output.json` — Output schema for workspace diagnostics: items, nextCursor, optional summary.
- `schemas/tools/vscode.lsp.documentSymbols.json` — Input schema for document symbols: required file URI.
- `schemas/tools/vscode.lsp.documentSymbols.output.json` — Output schema for document symbols: symbols array, ranges, and ids.
- `schemas/tools/vscode.lsp.hover.json` — Input schema for hover requests: file URI and position.
- `schemas/tools/vscode.lsp.hover.output.json` — Output schema for hover: contents fragments, optional range, optional summary.
- `schemas/tools/vscode.lsp.references.json` — Input schema for references: uri, position, cursor, and pageSize.
- `schemas/tools/vscode.lsp.references.output.json` — Output schema for references: items list, nextCursor, optional summary.
- `schemas/tools/vscode.lsp.workspaceSymbols.json` — Input schema for workspace symbols: query, cursor, and pageSize.
- `schemas/tools/vscode.lsp.workspaceSymbols.output.json` — Output schema for workspace symbols: items list, nextCursor, optional summary.
- `src/extension.ts` — Extension entrypoint: validates settings, manages token commands, starts/stops local server.
- `src/logging/redact.ts` — Logging helpers that redact sensitive headers and tokens and truncate output.
- `src/mcp/handler.ts` — MCP JSON-RPC handler: lifecycle, header enforcement, and tools/list/tools/call routing.
- `src/mcp/jsonrpc.ts` — Strict single-message JSON-RPC parser/validator; rejects batches and malformed envelopes.
- `src/server/auth.ts` — SecretStorage-backed bearer auth verifier using SHA-256 digests and constant-time comparisons.
- `src/server/httpServer.ts` — HTTP server wrapper: localhost-only bind, requires tokens, wires router and handler.
- `src/server/origin.ts` — Origin allowlist check: exact-match when Origin header present, otherwise allow.
- `src/server/router.ts` — Transport router enforcing auth, origin, media types, size caps, and POST-only.
- `src/server/session.ts` — Session store for MCP-Session-Id: minting, deterministic eviction, and enforcement.
- `src/tools/catalog.ts` — Defines v1 tool names, descriptions, and builds tools/list entries with schemas.
- `src/tools/dispatcher.ts` — Routes tool calls, validates via schemas, enforces timeouts, normalizes ToolCallResult.
- `src/tools/handlers/ (truncated in tree; do not enumerate beyond what is listed)` — Tool handlers for v1 tools: normalization, gating, and provider calls.
- `src/tools/ids.ts` — Generates stable sha256 identifiers from canonical strings for tool outputs.
- `src/tools/paging/ (truncated in tree; do not enumerate beyond what is listed)` — Cursor encoding, validation, and deterministic pagination helpers for paged tools.
- `src/tools/schemaRegistry.ts` — Loads and compiles tool input/output schemas with Ajv; deterministic validation errors.
- `src/tools/sorting.ts` — Stable sorting and dedupe helpers for locations, symbols, and diagnostics.
- `src/tools/truncate.ts` — Deterministic hover truncation helpers enforcing fragment caps and response byte limits.
- `src/util/responseSize.ts` — UTF-8 and JSON byte length helpers for response size enforcement.
- `src/util/stableStringify.ts` — Stable JSON stringify wrapper using fast-stable-stringify for dedupe keys.
- `src/workspace/roots.ts` — Computes allowed filesystem roots from workspace folders and additional roots, realpath-canonicalized.
- `src/workspace/uri.ts` — Canonicalizes and gates file URIs using realpath resolution and allowed roots.
- `test/tsconfig.json` — TypeScript configuration for compiling tests with CommonJS and Mocha types.
- `test/types/vscode.d.ts` — Minimal VS Code type stubs for tests and compilation.
- `test/unit/cursor.test.ts` — Unit tests for cursor encoding, validation, pagination, and cap errors.
- `test/unit/diagnosticsDocument.test.ts` — Unit tests for document diagnostics normalization, ids, caps, and gating.
- `test/unit/diagnosticsWorkspace.test.ts` — Unit tests for workspace diagnostics grouping, filtering, paging, and caps.
- `test/unit/dispatcher.test.js` — Compiled JavaScript for dispatcher unit tests.
- `test/unit/dispatcher.test.js.map` — Source map for compiled dispatcher unit tests.
- `test/unit/dispatcher.test.ts` — Unit test ensuring dispatcher rejects unknown tool names with INVALID_PARAMS.
- `test/unit/documentSymbols.test.ts` — Unit tests for document symbol flattening, normalization, and cap enforcement.
- `test/unit/hover.test.ts` — Unit tests for hover normalization, sorting, MarkedString formatting, and range selection.
- `test/unit/httpServer-auth.test.js` — Compiled JavaScript for HTTP server auth unit tests.
- `test/unit/httpServer-auth.test.js.map` — Source map for compiled HTTP server auth unit tests.
- `test/unit/httpServer-auth.test.ts` — Unit test ensuring server refuses start without configured bearer tokens.
- `test/unit/ids.test.ts` — Unit tests for stable ID generation and sha256 format.
- `test/unit/redact.test.js` — Compiled JavaScript for redaction unit tests.
- `test/unit/redact.test.js.map` — Source map for compiled redaction unit tests.
- `test/unit/redact.test.ts` — Unit tests for redacting tokens and session IDs in logs and headers.
- `test/unit/responseSize.test.ts` — Unit tests for response size helpers and hover truncation behavior.
- `test/unit/router-boundary.test.js` — Compiled JavaScript for router boundary unit tests.
- `test/unit/router-boundary.test.js.map` — Source map for compiled router boundary unit tests.
- `test/unit/router-boundary.test.ts` — Unit tests for router boundaries: auth, origin checks, and header allowlist.
- `test/unit/sorting.test.ts` — Unit tests for sorting and dedupe helpers for locations and diagnostics.
- `test/unit/stableStringify.test.js` — Compiled JavaScript for stableStringify unit tests.
- `test/unit/stableStringify.test.js.map` — Source map for compiled stableStringify unit tests.
- `test/unit/stableStringify.test.ts` — Unit tests for stable JSON stringify ordering of objects and arrays.
- `test/unit/toolsList-schemas.test.js` — Compiled JavaScript for tools/list schema unit tests.
- `test/unit/toolsList-schemas.test.js.map` — Source map for compiled tools/list schema unit tests.
- `test/unit/toolsList-schemas.test.ts` — Unit tests ensuring tools/list includes input and output schemas for v1 tools.
- `tsconfig.json` — TypeScript compiler configuration for src build output, strict NodeNext ES2022.

## Update rule

- When additional files become available here, replace TODO lines with 6–20 word summaries and keep ordering stable.
