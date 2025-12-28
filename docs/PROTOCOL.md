# MCP Streamable HTTP Protocol (2025-11-25)

This document is the **authoritative protocol contract** for `vscode-mcp-lsp-gateway`. It defines the **Streamable HTTP** transport profile used by this extension’s local MCP server, including required headers, status codes, and lifecycle rules.

This repository targets **MCP Protocol Revision `2025-11-25`** and **only** that revision.

---

## 1. Transport overview

### 1.1 Endpoint

- **Single endpoint**: `POST {baseUrl}/mcp`
- Default base URL: `http://127.0.0.1:{port}`
- Default path: `/mcp`
- The server is **local-only** and MUST bind to `127.0.0.1` by default.

### 1.2 Message model

- **Each HTTP POST contains exactly one JSON-RPC object**:
  - a **request**, **notification**, or **response**
- **Batch JSON-RPC arrays are not supported** and MUST be rejected.

### 1.3 No server-initiated streaming (v1)

- The server does **not** initiate SSE streams in v1.
- `GET` is optional in v1 and may return `405 Method Not Allowed`.

---

## 2. Content negotiation and media types

### 2.1 Request content type

- `Content-Type` MUST be `application/json`.
- If missing or not `application/json`, respond `415 Unsupported Media Type`.

### 2.2 Accept requirements

Clients MUST send an `Accept` header that includes **both**:

- `application/json`
- `text/event-stream`

If the `Accept` header is missing, or present but does not include both values, respond `406 Not Acceptable`.

> Rationale: Streamable HTTP compatibility gating while keeping v1 response bodies JSON-only.

### 2.3 Response content type

- For JSON-RPC **requests**: respond with `Content-Type: application/json`.
- For accepted JSON-RPC **notifications** or **responses**: respond with **no body**.

---

## 3. Required headers

### 3.1 Authentication (required on every request)

All requests MUST include:

- `Authorization: Bearer <token>`

If missing/invalid, respond:

- `401 Unauthorized`

Notes:

- Authentication is checked on **every** request, including `initialize`.
- Sessions (if enabled) are **not** authentication and MUST NOT be treated as authorization.

### 3.2 Origin validation (conditional)

If the request includes an `Origin` header:

- It MUST match the configured allowlist.
- If not allowed, respond `403 Forbidden`.

If the request omits `Origin`, the server proceeds.

### 3.3 Protocol revision (required after initialization)

After a session is initialized (see §5), every request MUST include:

- `MCP-Protocol-Version: 2025-11-25`

If missing/invalid/unsupported, respond:

- `400 Bad Request`

### 3.4 Sessions (optional, but enforced if enabled)

If sessions are enabled:

- The server mints a cryptographically secure session id at initialization.
- The session id is returned as an HTTP response header on the `initialize` response:
  - `MCP-Session-Id: <session-id>`
- All subsequent requests MUST include:
  - `MCP-Session-Id: <session-id>`

Errors (when sessions are enabled and initialization has completed):

- Missing `MCP-Session-Id`: `400 Bad Request`
- Unknown/expired/terminated `MCP-Session-Id`: `404 Not Found`

---

## 4. HTTP method handling

### 4.1 POST

`POST` is the only supported method for MCP messages in v1.

### 4.2 GET (v1)

The server MAY return:

- `405 Method Not Allowed`

(Reserved for potential future server-initiated event streaming support.)

### 4.3 DELETE (v1)

The server MAY return:

- `405 Method Not Allowed`

(Reserved for potential future session termination support.)

---

## 5. Initialization lifecycle

### 5.1 Required sequence

1. Client sends JSON-RPC request `initialize`
2. Server replies with JSON-RPC response containing InitializeResult
   - If sessions enabled, this response includes `MCP-Session-Id` header
3. Client sends JSON-RPC **notification** `notifications/initialized`
4. Server responds `202 Accepted` (no body) for the notification

### 5.2 Initialize request requirements

- `initialize` MUST be a JSON-RPC request (i.e., it MUST include an `id`).
- `initialize.params.protocolVersion` MUST be `2025-11-25`.
  - If missing or not `2025-11-25`, the server returns a JSON-RPC error for invalid params (see §6.2).

### 5.3 Pre-init vs post-init rules

- **Pre-init**:
  - Auth required
  - Origin rules apply
  - `MCP-Protocol-Version` header MAY be absent
  - `MCP-Session-Id` header MAY be absent
- **Post-init**:
  - Auth required
  - Origin rules apply
  - `MCP-Protocol-Version: 2025-11-25` required
  - `MCP-Session-Id` required if sessions enabled

---

## 6. JSON-RPC handling and status codes

### 6.1 Accepted notifications and responses

If the POST body is a valid JSON-RPC **notification** (no `id`) or a JSON-RPC **response** (has `result` or `error` and an `id`) and is accepted:

- Respond: `202 Accepted`
- Body: **empty**

### 6.2 Requests (must receive a JSON-RPC response)

If the POST body is a valid JSON-RPC **request** (has `id`):

- Respond: `200 OK`
- Body: JSON-RPC response object
- `Content-Type: application/json`

If an error occurs while processing a JSON-RPC request that has an `id`:

- Return a JSON-RPC error object in the response body (still `200 OK`).

### 6.3 HTTP-layer errors (no JSON-RPC body)

Use HTTP errors when the server cannot or will not accept/process the message at the transport/security layer:

- `400 Bad Request`
  - Invalid JSON
  - Not a JSON object
  - JSON-RPC envelope missing required fields (`jsonrpc`, `method` for requests/notifications; `id` for requests)
  - Missing/invalid `MCP-Protocol-Version` (post-init)
  - Missing `MCP-Session-Id` when sessions are enabled (post-init)
- `401 Unauthorized`
  - Missing/invalid bearer token
- `403 Forbidden`
  - `Origin` present but not allowlisted
- `404 Not Found`
  - Unknown/expired/terminated `MCP-Session-Id` when sessions are enabled (post-init)
- `405 Method Not Allowed`
  - Any non-POST method (v1), unless explicitly supported
- `406 Not Acceptable`
  - Missing `Accept`, or `Accept` does not include both `application/json` and `text/event-stream`
- `413 Payload Too Large`
  - Request exceeds server max request size (see `docs/CONTRACT.md`)
- `415 Unsupported Media Type`
  - Missing/incorrect `Content-Type`
- `429 Too Many Requests`
  - Optional: rate limiting if enabled (must be deterministic and documented)
- `500 Internal Server Error`
  - Unexpected server failure before producing a JSON-RPC response

---

## 7. Message shape constraints

### 7.1 No batches

- Requests MUST be a single JSON object.
- Arrays are rejected (`400 Bad Request`).

### 7.2 Deterministic processing

Determinism rules are specified in `docs/CONTRACT.md`. This protocol layer MUST:

- Reject inputs that exceed caps deterministically (`413`, `400`, or JSON-RPC error, depending on where detected).
- Avoid nondeterministic partial responses.

---

## 8. Minimal examples

### 8.1 JSON-RPC request (initialize)

HTTP request:

- `POST /mcp`
- `Authorization: Bearer …`
- `Content-Type: application/json`
- `Accept: application/json, text/event-stream`

Body (single JSON-RPC object):

- `{"jsonrpc":"2.0","id":"1","method":"initialize","params":{"protocolVersion":"2025-11-25", "...":"..."}}`

HTTP response:

- `200 OK`
- `Content-Type: application/json`
- If sessions enabled: `MCP-Session-Id: ...`

Body:

- `{"jsonrpc":"2.0","id":"1","result":{...}}`

### 8.2 JSON-RPC notification (initialized)

HTTP request body:

- `{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}`

HTTP response:

- `202 Accepted`
- no body

---

## 9. Contract references

- Tool catalog, schemas, paging, determinism, and caps: `docs/CONTRACT.md`
- Threat model and security controls: `docs/SECURITY.md`

This protocol is **fail-closed**: when in doubt, reject the request deterministically.
