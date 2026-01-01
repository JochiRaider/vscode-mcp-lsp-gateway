# AGENTS.md — mcp-lsp-gateway

This repository is a **VS Code extension** that embeds a **local-only MCP server** in the VS Code extension host and exposes a **minimal, read-only, LSP-like tool surface** over **MCP Streamable HTTP (Protocol 2025-11-25)** for **GPT-5.2-Codex** consumption (no MCP backwards compatibility).

The project is intentionally **contract-first**: behavior is defined by `docs/PROTOCOL.md`, `docs/CONTRACT.md`, `docs/SECURITY.md`, and `docs/SCHEMA.md`. Code, schemas, and tests must track those documents exactly.

## Purpose and scope (this file)

- Applies repo-wide unless a more specific `AGENTS.md` / `AGENTS.override.md` exists in a subdirectory.
- Written for automated coding agents and human contributors.
- When in doubt: **fail closed**, prefer **minimal diffs**, and verify behavior against code + tests.

---

## Non-negotiables (v1)

### Scope

- **Read-only only**: no edits, no rename, no apply-edits, no write-capable code actions, no arbitrary command execution.
- **Protocol**: MCP **Streamable HTTP** for **Protocol Revision `2025-11-25` only** (no backward compatibility).
- **Tool catalog is fixed** (v1):
  - `vscode.lsp.definition`
  - `vscode.lsp.references` (paged)
  - `vscode.lsp.hover`
  - `vscode.lsp.documentSymbols`
  - `vscode.lsp.workspaceSymbols` (paged)
  - `vscode.lsp.diagnostics.document`
  - `vscode.lsp.diagnostics.workspace` (paged)

### Security (fail-closed)

- **Localhost-only bind**: must bind to `127.0.0.1` in v1; refuse to start otherwise.
- Server must not run without a token; the extension may auto-provision a token in SecretStorage; malformed SecretStorage must fail closed. (see `docs/SECURITY.md`).
- **Auth on every request**: `Authorization: Bearer <token>` required for all calls, including `initialize`.
- **Origin allowlist**: if `Origin` is present and not allowlisted, reject.
- **Workspace/URI gating on inputs and outputs**:
  - allow only `file:` URIs
  - allow only paths under workspace roots plus explicitly configured additional roots
  - filter provider outputs so nothing outside allowed roots is returned
- **No outbound networking**: do not add `fetch`/`http(s)` clients/WebSockets/etc.
- **No secret leakage**: never log tokens, session IDs, raw bodies, or out-of-root paths; redact in debug logs.

### Runtime environment (WSL2 / Remote Development)

- This extension is a **workspace extension** (`extensionKind: ["workspace"]`), so when you open a folder in **Remote-WSL**, the extension (and the embedded HTTP server) runs **inside the WSL remote extension host**, not in the Windows UI extension host.
- **“Local-only / 127.0.0.1” is local to the extension host.** In common Windows 11 + WSL2 setups, Windows applications can still reach WSL2 services via `http://127.0.0.1:<port>`; if not, use the WSL instance IP as documented by Microsoft.
- `additionalAllowedRoots` must use **absolute paths as seen by the extension host**:
  - Remote-WSL: Linux paths (e.g., `/home/...`, `/mnt/c/...`)
  - Local Windows workspace: Windows paths (e.g., `C:\\...`)

### Determinism + hard bounds

- Canonicalize inputs; stable sort + dedupe all output lists.
- Cursor paging must be stable and derived from canonical sorted full result sets.
- Enforce hard caps (bytes/items/total-set caps/timeouts). **No nondeterministic partial results**—return deterministic errors instead.
- Tool outputs are **structuredContent-first**:
  - `structuredContent` is the canonical machine payload.
  - To reduce token usage, the `content` array should be empty or contain only a minimal, non-sensitive text summary.
  - Do not serialize full JSON results into `content` for legacy MCP clients (out of scope for v1).

---

## How to validate (local dev)

### Install and build

- Install dependencies:
  - If `package-lock.json` exists: `npm ci`
  - Otherwise: `npm install` (required before `npm ci` can work)
- Typecheck: `npm run check-types`
- Build extension bundle: `npm run compile`
- Watch (tsc + esbuild): `npm run watch`

### Quality gates

- Lint: `npm run lint`
- Format check: `npm run format:check`
- Format write: `npm run format`

### Tests

- Full test run (uses VS Code test runner): `npm test`

Notes:

- Root `tsconfig.json` is scoped to `src/**`; test compilation is separate (`npm run compile-tests`).
- Sandboxed/offline agent runners: `npm test` may fail due to environment limits in the VS Code/Electron harness,
  not due to project code. If (and only if) the failure matches a known sandbox signature, treat it as expected and
  proceed after the pretest quality gates pass.
  - Examples of known signatures:
    - `getaddrinfo EAI_AGAIN update.code.visualstudio.com` (restricted DNS/network)
    - `FATAL:content/browser/sandbox_host_linux.cc:41 ... Operation not permitted` followed by `SIGTRAP`
  - Required gates (must pass):
    - `npm run check-types`
    - `npm run lint`
    - `npm run format:check`
    - `npm run compile-tests`
  - Agent/human summary must explicitly note: VS Code integration tests could not run in the sandbox and must be
    validated locally or in CI.
  - Do not change project defaults to accommodate sandbox limitations (for example, do not bake in `--no-sandbox`).

### Packaging

- Production bundle: `npm run package`
- Create VSIX: `npm run package:vsix`

---

## Running the extension (manual verification)

1. Launch the Extension Development Host (VS Code “Run Extension” flow).
2. Configure/enable the server:
   - Set `mcpLspGateway.enabled` to `true` (default is `false`).

3. Generate/copy Codex client configuration (auto-provisions a token if needed):
   - Run command: --“MCP LSP Gateway: Copy Codex config.toml (Token Inline)”--

If you want to set or rotate a known token explicitly, run --“MCP LSP Gateway: Set Bearer Token(s)”-- before copying config.

4. Paste the copied stanza into `~/.codex/config.toml` (Windows: `~\.codex\config.toml`).
5. Verify protocol behavior against `docs/PROTOCOL.md` (headers, status codes, init lifecycle).

If workspace is in Restricted Mode (untrusted), the server must not run.

---

## Configuration keys (do not invent new ones without updating docs/tests)

Primary settings (machine-scoped):

- `mcpLspGateway.enabled` (default `false`)
- `mcpLspGateway.bindAddress` (v1 enum: `127.0.0.1`)
- `mcpLspGateway.port` (default `3939`)
- `mcpLspGateway.endpointPath` (v1 enum: `/mcp`)
- `mcpLspGateway.allowedOrigins` (Origin allowlist; empty by default)
- `mcpLspGateway.additionalAllowedRoots` (absolute paths; empty by default)
- `mcpLspGateway.enableSessions` (default `true`; sessions are not auth)
- `mcpLspGateway.maxItemsPerPage` (default/max `200`)
- `mcpLspGateway.maxResponseBytes` (default/max `524288`)
- `mcpLspGateway.requestTimeoutMs` (default/max `2000`)
- `mcpLspGateway.debugLogging` (default `false`)
- `mcpLspGateway.secretStorageKey` (default `mcpLspGateway.authTokens`; tokens must remain in SecretStorage)

---

## Repo map (authoritative docs first)

- `docs/PROTOCOL.md` — Streamable HTTP transport + lifecycle (headers/status codes/init rules)
- `docs/CONTRACT.md` — tool catalog, canonicalization, ordering, paging, caps/timeouts, error taxonomy
- `docs/SECURITY.md` — threat model + enforced controls and invariants
- `docs/SCHEMA.md` - JSON Schemas for tool inputs and outputs, conventions, and change workflow
- `docs/REPO_MAP.md` — File inventory + one-line summaries for fast repo navigation (informational; verify against code/tests)
- `schemas/` — Ajv-validated input schemas (reject unknown fields; `additionalProperties: false`)
- `src/` — VS Code extension + embedded local HTTP server + tool handlers
- `test/` — unit/integration tests (must assert catalog + determinism + security invariants)
- `dist/` — build output (generated)

### Implementation anchors (read before changing contracts)

- `src/server/router.ts` — HTTP-layer validation (method/path/origin/auth/media-types/request caps)
- `src/server/auth.ts` — bearer token verification (SecretStorage-backed, constant-time compare)
- `src/mcp/jsonrpc.ts` — strict single-message JSON-RPC parsing/validation (no batches)
- `src/mcp/handler.ts` — init lifecycle + post-init header enforcement + tool routing entrypoint
- `src/workspace/roots.ts`, `src/workspace/uri.ts` — allowed-roots computation + URI canonicalization/gating
- `src/tools/catalog.ts` — `tools/list` surface and v1 catalog stability
- `src/tools/schemaRegistry.ts` + `schemas/tools/**` — Ajv input validation (reject unknown fields)
- `src/tools/dispatcher.ts` + `src/tools/handlers/**` — allowlist tool dispatch + per-tool behavior
- `src/util/stableStringify.ts` — canonical JSON for deterministic dedupe

---

## Contract-first change workflow (must follow)

### If you add/rename/modify a tool

- Update **`docs/CONTRACT.md`**
- Update **`schemas/`** for the tool input schema
- Update tests that assert:
  - exact tool catalog (`tools/list`)
  - output shape stability
  - determinism (sort/dedupe/paging)
  - bounds and error codes

### If you change transport / headers / lifecycle

- Update **`docs/PROTOCOL.md`**
- Update protocol-level tests (including init sequence and post-init header enforcement)

### If you touch security controls / trust boundaries

- Update **`docs/SECURITY.md`**
- Add/adjust tests proving invariants still hold (auth, roots, origin behavior, logging hygiene)

If it is not in the contract, it is out of scope for v1.

---

## Implementation discipline (how to work safely)

- Prefer small, reversible diffs. Avoid cross-cutting refactors unless contract-driven.
- Enforce “allowlist routing” for tool invocation (only the documented tools).
- Keep module semantics consistent with the repo’s ESM + NodeNext setup:
  - Use ESM imports/exports (no CJS `require`).
  - Preserve relative import specifiers with `.js` extensions where used.
  - Prefer `node:`-prefixed built-in imports.
- Never “helpfully” accept ambiguous input shapes:
  - JSON-RPC envelope must be strict
  - input schemas must be strict
  - protocol must fail closed
- When changing paging/cursors, add tests for:
  - canonicalization → stable sort → dedupe → stable cursor slicing
  - cursor rejection on mismatch / decode errors
- Logging must remain safe-by-default:
  - redact auth/session headers
  - do not log raw request bodies
  - truncate deterministically

---

## Planning gate (ExecPlan)

Before making broad/risky changes (multi-tool refactors, cursor algorithm changes, security boundary changes, or large doc/schema rewrites),
write a short plan and keep it updated as you implement:

- Goal + non-goals
- Files/areas in scope
- Step sequence
- Risks + rollback/exit criteria
- Test/validation plan

---

## When instructions are unclear

1. Treat `docs/PROTOCOL.md`, `docs/CONTRACT.md`, and `docs/SECURITY.md` as the source of truth.
2. Search for existing precedent in `src/` and `test/` and follow established patterns (canonicalization/filtering/paging).
3. If still blocked, choose a **safe, fail-closed behavior** and leave a `TODO(verify): ...` marker tied to a specific file/line.
4. Do not invent scripts, settings keys, tool names, or capability claims—verify in-repo before documenting.
