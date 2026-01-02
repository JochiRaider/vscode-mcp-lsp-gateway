# VS Code MCP LSP Gateway

A VS Code extension that exposes a minimal, **read-only** subset of VS Code’s language intelligence (LSP-like features) as MCP tools over **Streamable HTTP**, designed for deterministic, fail-closed operation under hard caps.

## Quick start (VS Code + Codex IDE extension)

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

### 4) Configure Codex IDE extension to use this MCP server (Codex config.toml)
Codex (CLI and IDE extension) reads MCP servers from `~/.codex/config.toml`. The CLI and IDE extension share the same file. 

To open the file from the Codex IDE extension:
- Open the Codex panel, select the gear icon, then choose **Codex Settings > Open config.toml** (in some views it may appear under MCP settings). 

Now add an entry for this gateway. You have two practical options:

#### Option A (simplest): inline token in the config
Use this extension’s command palette helper:

- **MCP LSP Gateway: Copy Codex config.toml (Token Inline)**

Paste the generated stanza into `~/.codex/config.toml`.

#### Option B (recommended): keep the token out of the file
Codex supports Streamable HTTP MCP servers with `bearer_token_env_var` (or `env_http_headers`) so secrets can come from the environment. 

Example stanza:

```toml
[mcp_servers.vscode_mcp_lsp_gateway]
url = "http://127.0.0.1:3939/mcp"

# Put the token in an environment variable, not in this file.
bearer_token_env_var = "MCP_LSP_GATEWAY_TOKEN"

# Required by this gateway’s transport contract.
http_headers = {
  "MCP-Protocol-Version" = "2025-11-25",
  "Accept" = "application/json, text/event-stream",
  "Content-Type" = "application/json"
}

enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Note: if sessions are enabled (default), the server returns `MCP-Session-Id` on `initialize` and the client must echo it on subsequent requests.

### 5) Install and sign in to the Codex IDE extension (if needed)

Codex’s VS Code extension is available via the VS Code Marketplace and works with VS Code forks (Cursor, Windsurf). Windows support is experimental; for best results on Windows, use a WSL workspace.

### 6) Where to see logs (VS Code)

Open **View → Output** and select the **“MCP LSP Gateway”** output channel.

## Why this exists

AI coding agents frequently need semantic code understanding (definitions, references, symbols, diagnostics) to navigate and reason about large workspaces. VS Code already has that knowledge via its active language providers.

This gateway exposes that knowledge through a strictly-bounded MCP tool surface so agents can query language features directly, without broad “execute commands” or write-capable APIs.

## Key properties

* **Localhost only**: the server binds to `127.0.0.1` and refuses to start otherwise.
* **Mandatory auth**: every request requires `Authorization: Bearer <token>`.
* **Workspace / URI gating**: only `file:` URIs; requests and returned locations are restricted to allowed workspace roots.
* **Read-only**: no edits, no rename/applyWorkspaceEdit, no code actions, no arbitrary command execution.
* **Deterministic outputs**: canonicalization + stable sorting + dedupe.
* **Deterministic paging**: paged tools use cursor snapshot semantics (“cursor carries snapshot”) and reject stale/expired cursors deterministically.

For the normative contract (caps, schemas, determinism rules): see `docs/CONTRACT.md`.
For the threat model and enforced controls: see `docs/SECURITY.md`.
For transport/lifecycle requirements: see `docs/PROTOCOL.md`.

## Tool catalog

These tools are exposed via MCP `tools/list` and invoked with `tools/call`:

* `vscode.lsp.definition`
* `vscode.lsp.references` (paged)
* `vscode.lsp.hover`
* `vscode.lsp.documentSymbols`
* `vscode.lsp.workspaceSymbols` (paged)
* `vscode.lsp.diagnostics.document`
* `vscode.lsp.diagnostics.workspace` (paged)

## Configuration

All settings live under `mcpLspGateway.*`:

* `enabled` (default: `false`)
* `bindAddress` (default: `127.0.0.1`, enforced)
* `port` (default: `3939`)
* `endpointPath` (default: `/mcp`, enforced)
* `enableSessions` (default: `true`)
* `allowedOrigins` (default: `[]`)

  * If an `Origin` header is present, it must match this allowlist exactly.
* `additionalAllowedRoots` (default: `[]`)

  * Extra filesystem roots added to the workspace-root allowlist (security-critical; keep minimal).
* `maxItemsPerPage` (default: `200`, hard-bounded)
* `maxResponseBytes` (default: `524288`, hard-bounded)
* `requestTimeoutMs` (default: `2000`, hard-bounded)
* `debugLogging` (default: `false`)
* `secretStorageKey` (default: `mcpLspGateway.authTokens`)

If any setting violates v1 invariants, the server fails closed and will not start.

## Security notes

* Do not store bearer tokens in repositories, tickets, chat logs, screenshots, or committed config files.
* Prefer environment-sourced tokens (Codex `bearer_token_env_var`) when feasible. 
* Keep `additionalAllowedRoots` narrowly scoped. Avoid broad roots such as your entire home directory.

See `docs/SECURITY.md` for the full threat model and testable invariants.

## Limitations (intentional in v1)

* `file:` URIs only (no other schemes)
* Read-only tool surface (no write operations)
* Requests and responses are filtered to allowed roots
* Hard caps and deterministic failures when caps are exceeded

## Development

See `AGENTS.md` for repository workflow guidance and quality gates.