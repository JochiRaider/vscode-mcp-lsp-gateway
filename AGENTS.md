# AGENTS.md

## Purpose

- Build a local-only MCP server inside the VS Code extension host that exposes a minimal, read-only, deterministic tool surface over Streamable HTTP.
- Keep the v1 tool catalog stable and bounded:
  - `vscode.lsp.definition`
  - `vscode.lsp.references` (paged)
  - `vscode.lsp.hover`
  - `vscode.lsp.documentSymbols`
  - `vscode.lsp.workspaceSymbols` (paged)
  - `vscode.lsp.diagnostics.document`
  - `vscode.lsp.diagnostics.workspace` (paged)
- Security-by-default is mandatory: localhost bind, bearer auth on every request, Origin allowlist when present, workspace/URI gating (inputs and outputs), no outbound network calls.
- Success for any change: contracts/schemas/tests updated together, determinism preserved, and no trust boundary expansion.

## Quickstart

- Install deps: `npm ci`
- Build: `npm run build`
- Run unit tests: `npm run test:unit`
- Run full test suite: `npm test` (build + unit + integration)
- Lint: `npm run lint`
- Package: `npm run package` (builds a `.vsix`)

## Golden commands

- Install: `npm ci`
- Build: `npm run build`
- Watch: `npm run watch`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Full tests: `npm test`
- Lint: `npm run lint`
- Package VSIX: `npm run package`

## Repo map

- `docs/PROTOCOL.md` — Streamable HTTP transport contract (MCP 2025-11-25): headers, status codes, lifecycle.
- `docs/CONTRACT.md` — tool catalog, determinism rules, paging, caps/timeouts, error taxonomy.
- `docs/SECURITY.md` — threat model + enforced controls (auth/origin/roots/redaction/no outbound net).
- `schemas/` — per-tool input JSON Schemas (Ajv-validated; output schemas may be added later).
- `src/` — VS Code extension + local HTTP server + tool handlers.
- `test/` — unit + integration tests.
- `dist/` — compiled extension output (generated).

## Contract-first workflow (non-negotiable)

- If you add/rename/modify a tool:
  - Update `docs/CONTRACT.md`
  - Update the tool schemas under `schemas/`
  - Update tests that assert the exact catalog and output shapes
- If you change transport/lifecycle/header behavior:
  - Update `docs/PROTOCOL.md`
  - Update protocol-level tests (smoke harness + any integration tests)
- If you change security controls or trust boundaries:
  - Update `docs/SECURITY.md`
  - Add/adjust tests proving security invariants still hold
- Do not introduce “helpful” undocumented behaviors. If it is not in the contract, it is out of scope for v1.

## Lifecycle and protocol invariants

- Single endpoint: `POST /mcp` only (v1 may return `405` for `GET`).
- Each HTTP POST body is exactly one JSON-RPC object (no batch arrays).
- Accept/Content-Type requirements and HTTP status behaviors are defined in `docs/PROTOCOL.md` and must be implemented fail-closed.
- Initialization flow must follow the protocol contract:
  - `initialize` (request) → JSON-RPC response
  - `notifications/initialized` (notification) → `202 Accepted`
  - Post-init header enforcement and session enforcement per `docs/PROTOCOL.md`

## Security guardrails (do not weaken)

- Local-only bind:
  - Must bind to `127.0.0.1` in v1. Refuse to start if configured otherwise.
- Auth on every request:
  - Require `Authorization: Bearer <token>` for all calls, including `initialize`.
  - Sessions are not authorization.
  - Token checks must be constant-time. Support token rotation by accepting multiple valid tokens.
- Origin validation:
  - If `Origin` is present and not allowlisted, reject.
- Workspace/URI gating on inputs and outputs:
  - Only allow `file:` URIs.
  - Allow only paths within workspace folders plus explicitly configured additional roots.
  - Filter provider outputs so nothing outside allowed roots is returned.
- No outbound network calls:
  - Do not add `fetch`/`http`/`https`/WebSocket client usage.
- Read-only enforcement:
  - No edits, renames, apply-edits, or general codeActions surface in v1.

## Determinism and bounds (must be enforced in code)

- Canonicalize all inputs (URIs, numeric fields, strings) before execution.
- Stable sort all output arrays by the keys defined in `docs/CONTRACT.md`.
- Deterministically dedupe before paging.
- Cursor paging must be stable and derived from the canonical sorted full result set.
- Enforce hard caps and timeouts from `docs/CONTRACT.md` independent of client preferences.
- If you cannot compute the canonical result set within caps/timeouts, return deterministic errors (never nondeterministic partial results).

## Validation and logging rules

- Validation:
  - Ajv validates tool inputs against JSON Schemas.
  - Output shapes are defined in `docs/CONTRACT.md`; output schemas may be added later.
  - Transport and JSON-RPC envelope handling must fail closed (do not accept ambiguous shapes).
- Logging:
  - Default logs must not contain bearer tokens, session IDs, raw request bodies, or out-of-root paths.
  - Debug logging must be opt-in and redact Authorization and session headers; keep logs bounded/truncated.

## Development discipline

- Keep diffs minimal and reversible; avoid cross-cutting refactors unless the contract requires it.
- Implement one tool handler at a time; do not broaden surfaces opportunistically.
- When touching paging/cursors, add unit tests for:
  - canonicalization
  - stable sorting
  - deduplication
  - cursor stability across repeated calls

## If instructions are missing or unclear

- Search the repo for precedent and follow existing patterns (especially canonicalization, filtering, paging).
- Consult `docs/CONTRACT.md` and the corresponding schema under `schemas/` before making assumptions.
- If still blocked, add a `TODO(verify): ...` marker and choose a safe, fail-closed behavior.
- Never invent scripts, paths, settings keys, or capabilities. Verify via repo search before documenting.
