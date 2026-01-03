# SECURITY.md - Threat Model and Enforced Controls (v1)

This document is the **authoritative security contract** for `vscode-mcp-lsp-gateway` v1.

The server runs **inside the VS Code extension host** and exposes a **local-only** MCP endpoint over **Streamable HTTP**. The tool surface is **read-only** and intentionally minimal.

This project is **structuredContent-first** and explicitly does **not** support MCP backwards compatibility behaviors that increase payload size or ambiguity.

See also:

- Transport contract: `docs/PROTOCOL.md`
- Tool + determinism + limits: `docs/CONTRACT.md`

---

## 1. Security objectives

1. Prevent unauthorized access to workspace source code, symbols, locations, or diagnostics.
2. Prevent data exfiltration beyond intended trust boundaries (workspace roots + explicit additional roots).
3. Minimize attack surface (single endpoint, POST-only, strict schemas, no write tools).
4. Be deterministic and bounded to reduce DoS risk and eliminate nondeterministic partial leakage.
5. Avoid secret leakage in logs, error messages, and diagnostics payloads.
6. Keep outputs minimal by default (token and accidental leakage minimization).

---

## 2. Trust boundaries and assets

### 2.1 Assets

- Workspace source code and metadata (symbols, definitions, references).
- Diagnostics (may reveal file names, code snippets, error messages).
- Local filesystem paths and directory structure.
- Authentication secrets (bearer tokens).
- Session identifiers (if enabled).

### 2.2 Trust boundaries

- Inside boundary: VS Code extension host process, VS Code language feature stack.
- Local boundary: HTTP requests to `127.0.0.1` only (local to the extension host runtime).
- Outside boundary: any other local process, browser context, or untrusted extension attempting to call the endpoint.

### 2.3 Runtime environments (Local VS Code vs Remote-WSL)

This extension is a **workspace extension** and may run in a remote extension host.

- **Local workspace (Windows VS Code):** the server runs on Windows; `127.0.0.1` is Windows loopback.
- **Remote-WSL workspace:** the server runs inside the WSL2 environment; `127.0.0.1` is WSL loopback.
  - In common Windows 11 + WSL2 configurations, Windows processes can still reach WSL2 services via `http://127.0.0.1:<port>`.
  - If localhost forwarding is not available in a given setup, treat this as an operational incompatibility rather than relaxing bind rules.

Security impact:

- “Local-only” means “local to the machine running the extension host.” In Remote-WSL, that includes both Windows host processes and WSL processes as “local attackers.”

---

## 3. Threat model

This threat model assumes:

- The endpoint is reachable only from the same machine via localhost.
- Attackers may include:
  - malware on the workstation
  - an untrusted local process
  - a web page using the browser to attempt requests to localhost (DNS rebinding, CSRF-like patterns)
  - a different VS Code extension attempting to call the endpoint
  - a compromised or misconfigured client that sends oversized or malformed requests

Notes:

- v1 does not target browser-based clients. The combination of:
  - mandatory `Authorization: Bearer ...` and
  - strict method allowlist (POST-only)
    will typically prevent browsers from successfully issuing authenticated requests due to preflight behavior.
    Origin validation remains defense-in-depth against localhost attack patterns.

### 3.1 Threats (STRIDE-style)

**Spoofing**

- An attacker forges requests to the localhost endpoint.
- An attacker replays a captured request or session id.

**Tampering**

- An attacker attempts path traversal, URI confusion, or symlink tricks to access non-workspace files.
- An attacker injects malformed JSON or attempts limit overflows to bypass validation.

**Repudiation**

- A client disputes what it requested or received (audit concerns).

**Information disclosure**

- Leakage of code outside workspace roots (dependencies, user home directory).
- Leakage via logs, error messages, stack traces, or debug dumps.
- Leakage via diagnostics or language-provider returns referencing external files.

**Denial of service**

- Oversized requests or expensive symbol/diagnostic queries.
- High-frequency request floods on localhost.

**Elevation of privilege**

- Using the server to access files outside intended roots.
- Leveraging VS Code provider behaviors to return out-of-root locations.

---

## 4. Enforced security controls (v1)

### 4.1 Network binding (local-only)

- The server MUST bind to `127.0.0.1` by default.
- The server MUST NOT bind to `0.0.0.0` or any non-loopback interface in v1.
- If configured to bind differently, the server MUST refuse to start (fail closed).

Mitigates: remote network access, lateral movement.

### 4.2 Workspace Trust and activation safety

- In untrusted workspaces (VS Code Restricted Mode), the extension MUST NOT start the MCP HTTP server by default.
- If an override exists in future versions, it MUST be explicit, opt-in, and documented here with an updated threat model and tests.

Mitigates: accidental exposure when opening untrusted repositories.

### 4.3 Authentication (mandatory, every request)

- Every request MUST include `Authorization: Bearer <token>`.
- The server MUST verify bearer tokens on **every request**, including `initialize`.
- Token comparison MUST be constant-time.
- Token rotation is supported by allowing multiple configured valid tokens.
- Authentication is independent of sessions (sessions are not authorization).

Mitigates: spoofing, unauthorized access.

#### 4.3.1 Token storage requirements (no plaintext settings)

- Bearer tokens MUST be stored using VS Code SecretStorage (or an equivalent OS-backed secure store).
- Tokens MUST NOT be stored in workspace settings, user settings, checked-in config files, logs, or diagnostics.
- The server MUST NOT run without at least one bearer token in SecretStorage.
- If no token exists (or the stored token list is empty), the extension SHOULD auto-provision a high-entropy token into SecretStorage before starting.
- If the SecretStorage value is malformed/unparseable, the extension MUST refuse to start and require explicit operator action (run “Clear Bearer Token(s)” and re-enable).

Notes:

- The extension SHOULD provide an interactive flow to set or rotate tokens.
- The extension provides interactive commands to manage tokens:
  - **“MCP LSP Gateway: Set Bearer Token(s)”**
  - **“MCP LSP Gateway: Copy Codex config.toml (Token Inline)”**
  - **“MCP LSP Gateway: Clear Bearer Token(s)”**
- Tokens SHOULD be high-entropy (for example, 32+ random bytes encoded as base64url or hex).

Mitigates: secret leakage and accidental repository check-in.

### 4.4 Origin validation (conditional allowlist)

- If an `Origin` header is present, it MUST match an explicit allowlist.
- If not allowlisted, respond `403 Forbidden`.
- If `Origin` is absent, the server proceeds.

This is explicitly designed to reduce risk of browser-based localhost attacks while not relying on CORS as a security boundary.

Mitigates: browser-driven CSRF-like access to localhost endpoint, DNS rebinding exploitation.

Notes:

- v1 does not implement CORS as an access mechanism and does not treat CORS as a security boundary.
- Allowlist matching is intended to be exact and conservative (no wildcards, no normalization).
- Origin validation is defense-in-depth. The primary authorization control remains the bearer token.

### 4.5 Protocol hardening (fail closed)

- Single endpoint `/mcp`, POST-only for messages (see `docs/PROTOCOL.md`).
- Request body MUST be exactly one JSON-RPC object; reject arrays/batches.
- Strict content negotiation:
  - `Content-Type: application/json` required
  - `Accept` MUST include `application/json` and `text/event-stream`
- After initialization:
  - require `MCP-Protocol-Version: 2025-11-25`
  - require `MCP-Session-Id` if sessions are enabled
- Reject missing/invalid protocol headers deterministically.

Mitigates: request smuggling, downgrade confusion, incompatible clients, accidental exposure.

### 4.6 Sessions (optional, not authorization)

If sessions are enabled:

- Session IDs MUST be cryptographically secure and non-deterministic.
- A session ID MUST be minted on successful `initialize` and returned via `MCP-Session-Id`.
- Post-init:
  - Missing `MCP-Session-Id` MUST be rejected (`400 Bad Request`).
  - Unknown/expired session IDs MUST be rejected (`404 Not Found`).
- Session IDs MUST NOT be treated as authorization and MUST NOT replace bearer auth.

Notes:

- In v1, “expired” means deterministically evicted from the session store (size cap). No TTL-based expiry is defined.

Mitigates: replay and cross-session confusion.

### 4.7 Workspace and URI gating (inputs and outputs)

The server MUST define an allowlist of filesystem roots:

- all open VS Code workspace folder roots
- plus any additional configured roots (explicit, opt-in)

**Inputs**

- Only allow `file:` URIs.
- Canonicalize and validate paths.
- Reject any input URI outside allowed roots.

**Outputs**

- Filter all returned locations, symbols, and diagnostics to allowed roots.
- Remove out-of-root locations rather than returning partial/relative forms.
- If filtering produces an empty result set, return empty outputs (not an error), unless the input itself was out-of-root.

**Symlink policy (required)**

- Root checks MUST be performed on resolved real paths (for both the candidate path and each allowed root), or symlink traversal MUST be explicitly disallowed.
- Lexical prefix checks alone are insufficient.

Mitigates: information disclosure and elevation of privilege through provider returns and symlink bypass.

### 4.8 Read-only enforcement

- No tool may modify files or workspace state.
- No apply edits, rename, code actions that modify files, or arbitrary command execution surfaces.
- Tool routing is allowlist-only: only documented tools can be invoked.

Mitigates: tampering, elevation of privilege.

### 4.9 Limits and timeouts (DoS resistance)

Hard caps (as defined in `docs/CONTRACT.md`) MUST be enforced:

- max request bytes
- max response bytes
- max items and total-set caps for expensive queries
- per-request timeout
- deterministic paging for large result sets

If limits are exceeded, return deterministic errors rather than partial results.

Mitigates: denial of service, resource exhaustion, nondeterministic leakage.

### 4.10 Logging and secrets handling

- The server MUST NOT log:
  - bearer tokens
  - session IDs
  - raw request bodies
  - filesystem paths outside allowed roots
- Debug logging MUST be:
  - opt-in
  - redacted (Authorization and session headers, plus token-like values)
  - bounded (truncate long values deterministically)
- When enabled, debug traces are metadata-only (method/path, status, byte counts, durations, JSON-RPC method/kind,
  tool name + argument keys, cursor presence, and count summaries). No raw bodies, raw params, or out-of-root paths.
- Trace logging (separate OutputChannel) MUST be:
  - opt-in
  - sanitized to JSON-RPC shapes only (no raw bodies)
  - redacted (tokens/session IDs and path-like strings)
  - bounded (deterministic truncation and caps)

Mitigates: information disclosure.

### 4.11 Output minimization (token and leakage control)

- Tool responses MUST be structuredContent-first.
- Human-readable summaries (if any) MUST be short, optional, and MUST NOT include secrets.
- The implementation MUST NOT return whole-file contents or large unbounded blobs via hover/diagnostics; any provider text is implicitly constrained by response caps.

### 4.12 Error message hygiene

- Errors MUST NOT include secrets, raw payloads, or out-of-root paths.
- Stack traces MUST NOT be returned to clients.
- Tool errors use namespaced codes (see `docs/CONTRACT.md`) with minimal safe detail.

Mitigates: information disclosure.

### 4.13 No outbound network calls

- The implementation MUST NOT perform outbound network calls (no `fetch`, no `http(s)` client, no WebSockets).
- All operations MUST be local and use VS Code APIs only.

Mitigates: exfiltration paths, SSRF-like behaviors.

---

## 5. Operational guidance (secure defaults)

### 5.1 Token management

- Bearer tokens MUST be treated as secrets and MUST be managed via the extension’s SecretStorage-backed workflow.
- On first enable in a trusted workspace, the extension MAY auto-provision a high-entropy bearer token if none exists in SecretStorage.
- Rotate tokens by adding the new token first, then removing the old token after all clients have switched.
- Do not store tokens in workspace settings, user settings, logs, or any shared configuration that is committed to repositories.
- If you use a “copy config” convenience flow that embeds the token inline, treat the resulting `config.toml` as a secret:
  - do not commit or share it
  - restrict file permissions to the local user account where feasible
  - avoid pasting the token into tickets, chat, or screenshots

Client guidance:

- Prefer client-supported environment-based token injection instead of storing tokens directly in plaintext configuration files.
- If you must use plaintext token embedding for lowest friction, prefer short-lived tokens and rotate more frequently, and use the extension commands to clear and re-issue tokens as needed.

### 5.2 Origin allowlist

- If any client runs in a browser-like environment, set `allowedOrigins` to the expected origin(s).
- If you do not use browser-based clients, you may leave the allowlist empty; requests with an Origin header will be rejected unless explicitly allowed.

Note:

- Browser-based clients are out of scope for v1. Origin allowlisting is retained as a defense-in-depth control against browser-originated localhost attack attempts, not as a supported access path.

### 5.3 Additional allowed roots

- Avoid configuring broad roots (for example, the entire home directory).
- Prefer explicit project folders when you must add roots.
- Treat additional roots as security-critical configuration and keep them minimal.

### 5.4 Debug logging

- Keep disabled by default.
- Enable only for short troubleshooting sessions and review logs for accidental leakage.
- Prefer trace logging when you need to inspect sanitized JSON-RPC request/response shapes.

---

## 6. Security invariants (must remain true)

These invariants are testable and MUST be covered by automated tests:

1. Server binds only to `127.0.0.1` in v1.
2. Server does not start by default in untrusted workspaces.
3. Every request requires a valid bearer token.
4. If `Origin` is present and not allowlisted, the request is rejected.
5. Only `file:` URIs are accepted; non-file URIs are rejected.
6. Inputs outside allowed roots are rejected.
7. Outputs are filtered so nothing outside allowed roots is returned.
8. Root checks are not bypassable via symlinks (realpath policy enforced).
9. No tool enables write operations.
10. Hard caps and timeouts are enforced deterministically.
11. Secrets are never logged and never returned.

---

## 7. Reporting and changes

Security-related changes MUST:

- update this document if controls or assumptions change
- add or adjust tests proving invariants still hold
- remain fail-closed by default

Any proposal to weaken defaults (for example, non-local bind, unauthenticated mode, broader roots, starting in untrusted workspaces) is out of scope for v1 and requires an explicit opt-in design change with an updated threat model and tests.

---

## Appendix A. Defense-in-depth recommendations (not required by the v1 contract)

These items are widely used to harden localhost services, but are not declared as v1 requirements unless implemented and tested.

1. Host header allowlist (DNS rebinding hardening)
   - Validate `Host` against a strict allowlist (for example, `127.0.0.1`, `localhost`).
   - This reduces exposure to DNS rebinding patterns that pivot browsers into targeting localhost services.

2. Deterministic concurrency limiting
   - Enforce a small max in-flight request limit (global or per-session).
   - On overflow, return a deterministic error (for example, 429 or a stable JSON-RPC error), rather than queueing unbounded work.

3. Optional “strict Origin required” mode
   - For environments where all legitimate clients can send an `Origin` header, add an opt-in mode that rejects missing Origin.
