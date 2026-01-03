# VS Code MCP LSP Gateway

A VS Code extension that exposes a minimal, **read-only** subset of VS Code’s language intelligence (LSP-like features) as MCP tools over **Streamable HTTP**, designed for deterministic, fail-closed operation under hard caps.

## Quick start (VS Code + Codex client)

### 1) Install + trust the workspace (VS Code)

- Install this extension.
- Open your target workspace.
- Ensure the workspace is **trusted** (Restricted Mode will prevent server start by default).

### 2) Enable the gateway (VS Code)

Set:

- `mcpLspGateway.enabled = true`

Defaults are intentionally strict (localhost-only, sessions enabled, small server timeout); see **Configuration** below.

### 3) Provision and manage bearer tokens (VS Code)

Use the command palette:

- **MCP LSP Gateway: Set Bearer Token(s)** (recommended for explicit rotation)
- **MCP LSP Gateway: Clear Bearer Token(s)**

Tokens are stored in VS Code SecretStorage (not in settings). If no tokens are present, the gateway auto-provisions one in SecretStorage when starting, and you can retrieve it via the “Copy Codex config.toml” command.

### 4) Configure your MCP client (Codex config.toml)

Codex reads MCP servers from its `config.toml` file (location varies by install; see Codex docs).

Now add an entry for this gateway.

Use this extension’s command palette helper:

- **MCP LSP Gateway: Copy Codex config.toml (Token Inline)**

Paste the generated stanza into your `config.toml`.

Example stanza (placeholders shown):

```toml
[mcp_servers.vscode_mcp_lsp_gateway]
url = "http://127.0.0.1:3939/mcp"

# Required by this gateway’s transport contract.
http_headers = {
  "Authorization" = "Bearer ${BEARER_TOKEN}",
  "MCP-Protocol-Version" = "2025-11-25",
  "Accept" = "application/json, text/event-stream",
  "Content-Type" = "application/json"
}

enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Notes:

- `MCP-Protocol-Version: 2025-11-25` is required after `initialize` and is safe to send on all requests.
- If sessions are enabled (default), the server returns `MCP-Session-Id` on `initialize`. The client must echo it on subsequent requests.
- The server expects `notifications/initialized` before non-`ping` requests; otherwise it returns `-32600 Not initialized`.

### 5) Where to see logs (VS Code)

Open **View → Output** and select the **“MCP LSP Gateway”** output channel.

## Why this exists

AI coding agents frequently need semantic code understanding (definitions, references, symbols, diagnostics) to navigate and reason about large workspaces. VS Code already has that knowledge via its active language providers.

This gateway exposes that knowledge through a strictly-bounded MCP tool surface so agents can query language features directly, without broad “execute commands” or write-capable APIs.

## Key properties

- **Localhost only**: the server binds to `127.0.0.1` and refuses to start otherwise.
- **Mandatory auth**: every request requires `Authorization: Bearer <token>`.
- **Workspace / URI gating**: only `file:` URIs; requests and returned locations are restricted to allowed workspace roots.
- **Read-only**: no edits, no rename/applyWorkspaceEdit, no code actions, no arbitrary command execution.
- **Deterministic outputs**: canonicalization + stable sorting + dedupe.
- **Deterministic paging**: paged tools use cursor snapshot semantics (“cursor carries snapshot”) and reject stale/expired cursors deterministically.

For the normative contract (caps, schemas, determinism rules): see `docs/CONTRACT.md`.
For the threat model and enforced controls: see `docs/SECURITY.md`.
For transport/lifecycle requirements: see `docs/PROTOCOL.md`.

## Tool catalog

These tools are exposed via MCP `tools/list` and invoked with `tools/call`:

- `vscode_lsp_definition`
- `vscode_lsp_references` (paged)
- `vscode_lsp_hover`
- `vscode_lsp_documentSymbols`
- `vscode_lsp_workspaceSymbols` (paged)
- `vscode_lsp_diagnostics_document`
- `vscode_lsp_diagnostics_workspace` (paged)

## Configuration

All settings live under `mcpLspGateway.*`:

- `enabled` (default: `false`)
- `bindAddress` (default: `127.0.0.1`, enforced)
- `port` (default: `3939`)
- `endpointPath` (default: `/mcp`, enforced)
- `enableSessions` (default: `true`)
- `allowLegacyInitializeProtocolVersion` (default: `false`)
- `allowedOrigins` (default: `[]`)
  - If an `Origin` header is present, it must match this allowlist exactly.

- `additionalAllowedRoots` (default: `[]`)
  - Extra filesystem roots added to the workspace-root allowlist (security-critical; keep minimal).

- `maxItemsPerPage` (default: `200`, hard-bounded)
- `maxResponseBytes` (default: `524288`, hard-bounded)
- `requestTimeoutMs` (default: `2000`, hard-bounded)
- `debugLogging` (default: `false`)
- `secretStorageKey` (default: `mcpLspGateway.authTokens`)

If any setting violates v1 invariants, the server fails closed and will not start.

## Security notes

- Do not store bearer tokens in repositories, tickets, chat logs, screenshots, or committed config files.
- Prefer environment-sourced tokens when feasible (client-supported).
- Keep `additionalAllowedRoots` narrowly scoped. Avoid broad roots such as your entire home directory.

See `docs/SECURITY.md` for the full threat model and testable invariants.

## Limitations (intentional in v1)

- `file:` URIs only (no other schemes)
- Read-only tool surface (no write operations)
- Requests and responses are filtered to allowed roots
- Hard caps and deterministic failures when caps are exceeded

## Development

See `AGENTS.md` for repository workflow guidance and quality gates.

## Packaging

- `npm run package` bundles runtime dependencies into `dist/extension.js` (only `vscode` stays external).
- `npm run package:vsix` uses `--no-dependencies`, so the VSIX must run without `node_modules`.
- `test/unit/bundle.test.ts` guards against runtime imports for bundled deps (e.g., `fast-stable-stringify`).
