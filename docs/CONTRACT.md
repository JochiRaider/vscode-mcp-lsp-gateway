# CONTRACT.md

# Tool Catalog, Determinism, and Limits (v1)

This document is the **authoritative interface contract** for `vscode-mcp-lsp-gateway` v1.

It defines:

- The **tool catalog** (stable names, behavior, and I/O shapes)
- **Determinism rules** (canonicalization, ordering, paging)
- **Hard limits** (items, bytes, timeouts) that the server enforces irrespective of client preferences
- **Error taxonomy** (JSON-RPC errors and tool-level error codes)

This repository targets **MCP Protocol Revision `2025-11-25`** only. Transport rules are defined in `docs/PROTOCOL.md`.

---

## 1. Principles (non-negotiable)

### 1.1 Read-only

All tools are strictly **read-only**. No file writes, no edits, no rename, no code actions that modify files.

### 1.2 Workspace and URI gating

- Inputs and outputs MUST be constrained to:
  - currently opened VS Code workspace folder(s), plus
  - any additional filesystem roots explicitly configured in settings.

- Only `file:` URIs are allowed in v1.
- Returned locations/symbols/diagnostics MUST be filtered so nothing outside allowed roots is returned.

### 1.3 Determinism

For an unchanged workspace and unchanged inputs:

- tool outputs MUST be deterministic
- all lists MUST be stably sorted and deduplicated
- paging MUST be cursor-based and stable

### 1.4 Boundedness

The server enforces hard caps on:

- max items returned
- max bytes returned
- max processing time per request
- max request size

The server ignores client requests that exceed caps and returns bounded results or errors as specified below.

---

## 2. Tool discovery

### 2.1 `tools/list`

The server exposes tools via MCP `tools/list`. The returned set MUST contain exactly the v1 tools:

- `vscode.lsp.definition`
- `vscode.lsp.references`
- `vscode.lsp.hover`
- `vscode.lsp.documentSymbols`
- `vscode.lsp.workspaceSymbols`
- `vscode.lsp.diagnostics.document`
- `vscode.lsp.diagnostics.workspace`

No additional tools may be added or renamed without updating:

- this file (`docs/CONTRACT.md`)
- the tool JSON Schemas
- tests asserting the exact catalog

### 2.2 Tool metadata requirements

In `tools/list`, each returned tool entry MUST include:

- `name` (exact stable tool name)
- `description` (short, stable)
- `inputSchema` (JSON Schema **object**, inlined; v1 does not return `$ref` here)
- `outputSchema` (JSON Schema **object**, inlined; describes `structuredContent`)
- `annotations.readOnlyHint: true`

`readOnlyHint` MUST be `true` for all v1 tools.

---

## 3. Common data model

This contract defines **tool payload objects** (the machine-readable outputs for each tool) and how they are returned
over MCP `tools/call`.

### 3.0 MCP `tools/call` result envelope (normative)

For a successful `tools/call`, the JSON-RPC response `result` MUST be an MCP tool result envelope:

```json
{
  "isError": false,
  "structuredContent": {
    /* tool payload object (see §7) */
  },
  "content": []
}
```

Rules (v1):

- **StructuredContent-first**:
  - The canonical machine payload MUST be returned in `result.structuredContent`.
  - The tool payload object placed in `structuredContent` MUST conform to the per-tool outputs documented in §7.

- **No back-compat text JSON (token-minimizing)**:
  - The server MUST NOT serialize or duplicate the full tool payload JSON into `result.content`.
  - Clients MUST parse `structuredContent` for automation and MUST treat `content` as optional, human-oriented text.

- **`content` policy**:
  - `content` MAY be empty (`[]`).
  - If present, `content` MUST contain only short, non-sensitive text (for example a one-line summary), and MUST NOT
    include secrets, raw request bodies, or filesystem paths outside allowed roots.

- **Errors**:
  - Tool failures are returned as JSON-RPC `error` objects per §6 (not as `result.isError: true`) in v1.

### 3.1 Tool payload summary

Tool payload objects MAY include a `summary` string for human readability.
If present, `summary` MUST be short, stable, and non-sensitive (no secrets; no out-of-root paths).

### 3.2 Canonical URI

- All URIs MUST be returned in canonical form.
- Only `file:` URIs are returned.
- Any non-allowed URI MUST be omitted (filtered) rather than partially redacted.

### 3.3 Position and Range

All positions and ranges follow LSP conventions:

- `line`: 0-based integer
- `character`: 0-based integer

```json
{
  "position": { "line": 10, "character": 4 },
  "range": {
    "start": { "line": 10, "character": 4 },
    "end": { "line": 10, "character": 12 }
  }
}
```

### 3.4 Location

```json
{
  "uri": "file:///abs/path/to/file.ts",
  "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 10 } }
}
```

### 3.5 Paging envelope

Paged tools return a stable cursor that carries a **snapshot token**.

```json
{
  "items": [
    /* ... */
  ],
  "nextCursor": "opaque-string-or-null"
}
```

- `nextCursor` is `null` when no further pages exist.
- Cursor format is opaque to the client.
- Cursor MUST be derived deterministically from the canonical sorted full result set for the specific tool + canonicalized input.
- **Snapshot semantics (normative):**
  - A non-null cursor MUST only be valid for the same snapshot token it was minted with.
  - If the snapshot token in the cursor does not match the server’s current snapshot token for the request, the server MUST reject the request deterministically (see §3.6).
  - The server MUST retain the canonical full result set for the snapshot while paging; if it cannot retain the snapshot within caps, the request MUST fail deterministically (see §3.6).

### 3.6 Cursor algorithm (normative)

All paged tools MUST use the same cursor structure:

- The cursor payload is JSON:
  - `v`: integer cursor format version (v2)
  - `o`: integer offset into the **canonical sorted, deduped** result list
  - `k`: request key string (hex sha256 of canonical tool name + canonicalized input fields that affect the result)
  - `s`: snapshot key string (hex sha256; binds paging to a specific workspace state)

- The cursor string is `base64url(utf8(JSON))` with no padding.

Rules:

- `cursor: null` means `o = 0` and the server mints a cursor with the current `k` and current `s`.
- The server MUST reject a cursor if:
  - it cannot be decoded/parsed, or
  - `v` is not supported, or
  - `o` is not a non-negative integer, or
  - `k` does not match the current request key.

- Cursor rejection for the cases above MUST fail closed with `-32602 Invalid params` and tool error code `MCP_LSP_GATEWAY/CURSOR_INVALID`.
- **Snapshot mismatch:** if the cursor’s `s` does not match the server-computed current snapshot key for the request, the server MUST reject with `-32602 Invalid params` and tool error code `MCP_LSP_GATEWAY/CURSOR_STALE`.
- **Snapshot missing:** if the cursor is valid but the retained snapshot is not available (expired/evicted), the server MUST reject with `-32602 Invalid params` and tool error code `MCP_LSP_GATEWAY/CURSOR_EXPIRED`.
- **Snapshot retention failure:** if the server cannot retain the snapshot within caps, it MUST return `-32602 Invalid params` and tool error code `MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE` and MUST NOT return partial results.

Paging:

- After computing the full canonical list, the server slices:
  - `items = full[o : o + pageSize]` where `pageSize` is clamped to `MAX_PAGE_SIZE`.

- `nextCursor` is:
  - `null` if `o + pageSize >= full.length`, else a new cursor with `o = o + pageSize` and the same `k`and `s`.

### 3.6.1 Snapshot key derivation (normative)

The snapshot key binds paging to a specific workspace state so that a client cannot page across edits or other state changes.

- `s = sha256hex("v1|snapshot|" + k + "|" + epochTupleString)`

`epochTupleString` MUST be a deterministic string that changes whenever the tool’s canonical result set could change, including changes to:

- workspace folder set and allowed roots
- text documents (open/close/change/save)
- files (create/delete/rename)
- diagnostics (when relevant to the tool)

The implementation MUST construct `epochTupleString` deterministically from:

- `rootsKey = sha256hex(stableJsonStringify(sorted allowed roots))`
- `epochTuple = comma-separated epoch integers in tool-specific order`
- `epochTupleString = "roots:" + rootsKey + "|epochs:" + epochTuple`

The resulting string MUST be stable for an unchanged workspace.

### 3.6.2 Epoch sources and tool mapping (normative)

Epoch counters are monotonic integers maintained by the server to capture workspace state changes:

- `textEpoch`: increment on text document open/close/change/save.
- `fsEpoch`: increment on file create/delete/rename.
- `diagnosticsEpoch`: increment when VS Code diagnostics change.
- `rootsEpoch`: increment when the workspace folder set or allowed roots change.

Epoch tuples for paged tools MUST incorporate the relevant epochs:

- `vscode.lsp.references`: `textEpoch`, `fsEpoch`, `rootsEpoch`
- `vscode.lsp.workspaceSymbols`: `textEpoch`, `fsEpoch`, `rootsEpoch`
- `vscode.lsp.diagnostics.workspace`: `diagnosticsEpoch`, `fsEpoch`, `rootsEpoch`

The epoch tuple ordering used for snapshot keys is:

- always `rootsEpoch` first
- then `textEpoch` if applicable
- then `fsEpoch` if applicable
- then `diagnosticsEpoch` if applicable

### 3.7 Stable identifiers (when needed)

If an `id` is returned (symbols, diagnostics), it MUST be:

- deterministic for unchanged content and inputs
- derived from canonical fields

Normative format:

- `id = "sha256:" + hex(sha256(utf8(canonical_string)))`
- `canonical_string` is tool-specific and MUST be documented where `id` appears.

---

## 4. Determinism requirements

### 4.1 Canonicalization (inputs)

Before processing:

- Canonicalize URIs (`file:` only).
- Convert `file:` URI to a filesystem path and resolve it to a real path (symlinks resolved).
- Reject traversal and non-allowed roots:
  - Allowed roots are also resolved to real paths.
  - A candidate path is allowed only if it is equal to, or a descendant of, an allowed root real path.

- Normalize numeric values:
  - ensure integers
  - clamp negatives to invalid params (reject with `-32602`)

- Normalize strings:
  - trim leading/trailing whitespace for fields like `query`

### 4.2 Stable sorting (outputs)

All arrays MUST be stably sorted by documented keys.

Default ordering rules:

- **Locations**: by `uri`, then `range.start.line`, `range.start.character`, then `range.end.line`, `range.end.character`
- **Workspace symbols**: by `location.uri`, then location range ordering, then `name`, then `kind`, then `containerName` (missing last)
- **Document symbols**: by range ordering, then `name`, then `kind`, then `containerName` (missing last)
- **Diagnostics**: by `uri`, then `range.start.*`, then `severity` (missing last), then `code` (stringified; missing last), then `source` (missing last), then `message`

### 4.3 Deduplication

Exact duplicates MUST be removed deterministically after canonicalization and before paging.

Two items are duplicates if their canonical JSON representation is byte-for-byte identical after:

- URI canonicalization
- string normalization (`code` stringification rules apply)
- stable field omission rules (omit missing/undefined optional fields)

Canonical JSON is produced via `stableJsonStringify` in `src/util/stableStringify.ts` (fast-stable-stringify).

### 4.4 Paging (cursor-based, stable)

Paged tools MUST:

1. compute the full canonical result set
2. stable sort
3. dedup
4. enforce total-set caps (see §5.1)
5. slice deterministically using the cursor algorithm (§3.6)
6. retain the canonical full set for the snapshot; if retention fails, return `MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE`
7. on subsequent pages, reuse the retained snapshot or return `MCP_LSP_GATEWAY/CURSOR_EXPIRED` if it is unavailable

### 4.5 Timeouts and partial results

- The server enforces a hard per-request timeout.
- If a timeout is reached before producing a complete canonical set, the server MUST return a deterministic error rather than nondeterministic partial results.

---

## 5. Limits (hard caps)

These caps are enforced regardless of client input.

### 5.1 Global caps (defaults and maxima)

Implementations MUST enforce defaults at least as strict as:

- `MAX_REQUEST_BYTES`: 1,048,576 (1 MiB)
- `MAX_RESPONSE_BYTES`: 524,288 (512 KiB)
- `REQUEST_TIMEOUT_MS`: 2,000
- `MAX_ITEMS_NONPAGED`: 200
- `MAX_PAGE_SIZE`: 200
- `MAX_WORKSPACE_DIAGNOSTICS_ITEMS_TOTAL`: 5,000 (pre-paging canonical set cap)
- `MAX_WORKSPACE_SYMBOLS_ITEMS_TOTAL`: 20,000 (pre-paging canonical set cap)
- `MAX_REFERENCES_ITEMS_TOTAL`: 20,000 (pre-paging canonical set cap)

Notes:

- “pre-paging canonical set cap” means: after filtering to allowed roots, if the canonical result set exceeds this cap, the tool MUST return a deterministic “too many results” error rather than truncating unpredictably.
- The server may be configured to stricter values.
- In v1, the server MUST NOT operate with weaker bounds than listed above. If configuration supplies a larger value, the implementation MUST clamp it down to these maxima.

### 5.2 Per-tool caps

- Non-paged tools: hard cap at `MAX_ITEMS_NONPAGED`
- Paged tools: `pageSize` is clamped to `MAX_PAGE_SIZE`

### 5.3 Payload size enforcement

- If a response would exceed `MAX_RESPONSE_BYTES`, the tool MUST return a deterministic error (`MCP_LSP_GATEWAY/CAP_EXCEEDED`) rather than returning an oversized payload.

---

## 6. Error taxonomy

### 6.1 Transport vs tool errors

- Transport/security/protocol violations use HTTP status codes (see `docs/PROTOCOL.md`).
- Tool execution failures for JSON-RPC requests return JSON-RPC error objects.

### 6.2 JSON-RPC error codes (base)

The server uses standard JSON-RPC error codes where applicable:

- `-32700` Parse error
- `-32600` Invalid Request
- `-32601` Method not found
- `-32602` Invalid params
- `-32603` Internal error

### 6.3 Server-defined tool error codes (namespaced)

For tool-level failures, the JSON-RPC `error.data` MUST include at least:

```json
{
  "code": "MCP_LSP_GATEWAY/..."
}
```

`error.data` MAY also include a short human-readable `message` and a structured `details` object.
The server MUST NOT include secrets, raw request bodies, or filesystem paths outside allowed roots in any error fields.

Defined codes:

- `MCP_LSP_GATEWAY/INVALID_PARAMS`
  - input schema validation failed (missing required fields, wrong types, unknown fields rejected by `additionalProperties: false`)
  - returned as JSON-RPC `-32602 Invalid params`

- `MCP_LSP_GATEWAY/WORKSPACE_DENIED`
  - URI outside allowed roots; or no workspace open and no additional roots configured

- `MCP_LSP_GATEWAY/URI_INVALID`
  - non-file URI, malformed URI, path normalization failure, or realpath resolution failure

- `MCP_LSP_GATEWAY/CURSOR_INVALID`
  - cursor decode/parse failure, unsupported cursor version, negative/invalid offset, or request-key mismatch

- `MCP_LSP_GATEWAY/CURSOR_STALE`
  - cursor snapshot key mismatch (workspace state changed since cursor was minted)

- `MCP_LSP_GATEWAY/CURSOR_EXPIRED`
  - cursor is valid but the retained snapshot is missing (expired/evicted)

- `MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE`
  - snapshot could not be retained within caps for paging

- `MCP_LSP_GATEWAY/NOT_FOUND`
  - document not openable or position not resolvable

- `MCP_LSP_GATEWAY/CAP_EXCEEDED`
  - request/response size caps, item caps, total-set caps, or timeouts

- `MCP_LSP_GATEWAY/PROVIDER_UNAVAILABLE`
  - VS Code provider command not available for the document/language

- `MCP_LSP_GATEWAY/INTERNAL`
  - unexpected internal exception (redacted)

The server MUST NOT include secrets, raw request bodies, or filesystem paths outside allowed roots in error messages.

---

## 7. Tool catalog (v1)

All tools accept `input` consistent with their per-tool JSON Schemas in `schemas/tools/<toolname>.json`.

**Important (structuredContent-first):**

- The “Output” blocks in §7 define the **tool payload object** that MUST appear in `result.structuredContent` for a successful `tools/call` (see §3.0).
- The server MUST NOT duplicate that JSON object into `result.content`.

### 7.1 `vscode.lsp.definition`

**Purpose**: Find definition location(s) for symbol at a position.

**Input**

```json
{
  "uri": "file:///abs/path/to/file.ts",
  "position": { "line": 10, "character": 4 }
}
```

**Output**

```json
{
  "locations": [
    {
      "uri": "file:///abs/path/to/def.ts",
      "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 10 } }
    }
  ],
  "summary": "Found 1 definition."
}
```

**Determinism**

- Sort and dedup `locations` per §4.2 and §4.3.
- Filter out locations outside allowed roots.

**Limits**

- `locations.length <= MAX_ITEMS_NONPAGED`

---

### 7.2 `vscode.lsp.references` (paged)

**Purpose**: Find reference locations for symbol at a position.

**Input**

```json
{
  "uri": "file:///abs/path/to/file.ts",
  "position": { "line": 10, "character": 4 },
  "includeDeclaration": false,
  "pageSize": 50,
  "cursor": null
}
```

**Output**

```json
{
  "items": [
    {
      "uri": "file:///abs/path/to/file.ts",
      "range": { "start": { "line": 10, "character": 4 }, "end": { "line": 10, "character": 12 } }
    }
  ],
  "nextCursor": "opaque-or-null",
  "summary": "Returned 50 references (next page available)."
}
```

**Determinism**

- Canonicalize, filter, sort, dedup, enforce total-set cap, then page.
- Cursor algorithm is §3.6.
- Canonical list for paging is the location list after filtering.

**Limits**

- `pageSize` clamped to `MAX_PAGE_SIZE`
- total canonical set cap: `MAX_REFERENCES_ITEMS_TOTAL`

**Stable id (cursor request key)**

- `k = sha256hex("v1|vscode.lsp.references|" + canonical_uri + "|" + line + "|" + character + "|" + includeDeclaration)`

---

### 7.3 `vscode.lsp.hover`

**Purpose**: Get hover information at a position.

**Input**

```json
{
  "uri": "file:///abs/path/to/file.ts",
  "position": { "line": 10, "character": 4 }
}
```

**Output**

```json
{
  "contents": [{ "kind": "markdown", "value": "..." }],
  "range": { "start": { "line": 10, "character": 4 }, "end": { "line": 10, "character": 12 } },
  "summary": "Hover available."
}
```

**Normalization**

- Convert VS Code hover contents into an array of `{kind, value}` where:
  - `kind` is `"markdown"` or `"plaintext"`
  - `value` is a string

- After normalization, sort `contents` by `(kind, value)` to make provider ordering deterministic.

**Limits**

- The server MUST truncate deterministically to fit `MAX_RESPONSE_BYTES`:
  - First clamp fragments count (server-defined constant, default 8).
  - Then clamp per-fragment `value` length in code points (server-defined constant, default 8,192).
  - Finally enforce `MAX_RESPONSE_BYTES` by truncating the last fragment at a UTF-8 boundary.

- If truncation occurs, the server SHOULD reflect it in `summary`.

---

### 7.4 `vscode.lsp.documentSymbols`

**Purpose**: Return document symbols for a file.

**Input**

```json
{
  "uri": "file:///abs/path/to/file.ts"
}
```

**Output**

```json
{
  "symbols": [
    {
      "id": "sha256:...",
      "name": "MyFunction",
      "kind": 12,
      "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 20, "character": 0 } },
      "selectionRange": {
        "start": { "line": 2, "character": 9 },
        "end": { "line": 2, "character": 19 }
      },
      "containerName": "MyClass"
    }
  ],
  "summary": "Returned 42 document symbols."
}
```

**Determinism**

- v1 output is a **flattened list** (no hierarchy, no children arrays).
- If VS Code returns hierarchical `DocumentSymbol`, the server MUST flatten deterministically:
  - Depth-first traversal.
  - Within each parent, children are first stably sorted by range ordering, then traversed.
  - `containerName` is set to the immediate parent name (or omitted if none).

- Final output list MUST be stably sorted per §4.2 “Document symbols”.

**Stable identifier**

- `canonical_string = uri + "|" + name + "|" + kind + "|" + range.start + "|" + range.end + "|" + selectionRange.start + "|" + selectionRange.end + "|" + (containerName||"")`
- `id = sha256(canonical_string)` per §3.7.

**Limits**

- `symbols.length <= MAX_ITEMS_NONPAGED`
- If traversal exceeds the total-set cap, return `CAP_EXCEEDED` (no partial results).

---

### 7.5 `vscode.lsp.workspaceSymbols` (paged)

**Purpose**: Search workspace symbols by query string.

**Input**

```json
{
  "query": "MyFunc",
  "pageSize": 50,
  "cursor": null
}
```

**Output**

```json
{
  "items": [
    {
      "id": "sha256:...",
      "name": "MyFunction",
      "kind": 12,
      "location": {
        "uri": "file:///abs/path/to/file.ts",
        "range": { "start": { "line": 1, "character": 0 }, "end": { "line": 1, "character": 10 } }
      },
      "containerName": "MyClass"
    }
  ],
  "nextCursor": "opaque-or-null",
  "summary": "Returned 50 workspace symbols (next page available)."
}
```

**Determinism**

- Normalize `query` (trim).
- Reject whitespace-only queries after normalization with `Invalid params`.
- Filter results to allowed roots.
- Stable sort per §4.2 “Workspace symbols”.
- Dedup, enforce total-set cap, then page via §3.6.

**Stable identifier**

- `canonical_string = location.uri + "|" + name + "|" + kind + "|" + location.range.start + "|" + location.range.end + "|" + (containerName||"")`
- `id = sha256(canonical_string)` per §3.7.

**Limits**

- `pageSize` clamped to `MAX_PAGE_SIZE`
- total canonical set cap: `MAX_WORKSPACE_SYMBOLS_ITEMS_TOTAL`

**Stable id (cursor request key)**

- `k = sha256hex("v1|vscode.lsp.workspaceSymbols|" + normalized_query)`

**Stable id (cursor snapshot key)**

- `s = sha256hex("v1|snapshot|" + k + "|" + epochTupleString)`
  - `epochTupleString` is implementation-defined, but MUST change when any workspace state that could affect workspace symbol results changes (see §3.6.1).

---

### 7.6 `vscode.lsp.diagnostics.document`

**Purpose**: Return diagnostics for a single document.

**Input**

```json
{
  "uri": "file:///abs/path/to/file.ts"
}
```

**Output**

```json
{
  "uri": "file:///abs/path/to/file.ts",
  "diagnostics": [
    {
      "id": "sha256:...",
      "range": { "start": { "line": 5, "character": 2 }, "end": { "line": 5, "character": 10 } },
      "severity": 2,
      "code": "TS1234",
      "source": "ts",
      "message": "..."
    }
  ],
  "summary": "Returned 3 diagnostics."
}
```

**Normalization**

- `code` MUST be stringified if present:
  - if VS Code returns numeric code, convert to a decimal string
  - if absent/null, omit the field

**Determinism**

- Diagnostics are sorted per §4.2 “Diagnostics”.
- If the input URI is out of allowed roots, error `WORKSPACE_DENIED`.

**Stable identifier**

- `canonical_string = uri + "|" + range.start + "|" + range.end + "|" + (severity||"") + "|" + (code||"") + "|" + (source||"") + "|" + message`
- `id = sha256(canonical_string)` per §3.7.

**Limits**

- `diagnostics.length <= MAX_ITEMS_NONPAGED`

---

### 7.7 `vscode.lsp.diagnostics.workspace` (paged)

**Purpose**: Return diagnostics across the workspace.

**Input**

```json
{
  "pageSize": 100,
  "cursor": null
}
```

**Output**

```json
{
  "items": [
    {
      "uri": "file:///abs/path/to/file.ts",
      "diagnostics": [
        {
          "id": "sha256:...",
          "range": {
            "start": { "line": 5, "character": 2 },
            "end": { "line": 5, "character": 10 }
          },
          "severity": 2,
          "code": "TS1234",
          "source": "ts",
          "message": "..."
        }
      ]
    }
  ],
  "nextCursor": "opaque-or-null",
  "summary": "Returned diagnostics for 100 files (next page available)."
}
```

**Determinism (chosen strategy, v1)**

- Paging is **by file groups**:
  - `items` is a list of `{uri, diagnostics:[...]}` per file.
  - `pageSize` counts files (items), not individual diagnostics.

- Canonical workspace set is computed from `vscode.languages.getDiagnostics()`:
  - filter to allowed roots
  - stable sort files by `uri`
  - within each file, normalize and stable sort diagnostics per §4.2 “Diagnostics”

- Dedup:
  - dedup diagnostics within each file after normalization
  - omit any file whose diagnostics list becomes empty after filtering/dedup

**Total-set cap**

- The total number of files with at least one diagnostic (after filtering) MUST NOT exceed `MAX_WORKSPACE_DIAGNOSTICS_ITEMS_TOTAL`.
- If it would exceed the cap, return `CAP_EXCEEDED` (do not truncate).

**Per-file cap**

- Within each file, `diagnostics.length` MUST be capped at `MAX_ITEMS_NONPAGED` using deterministic truncation (keep the first N diagnostics after canonical sort).
- If truncation occurs for any file, the server SHOULD reflect it in `summary`.

**Limits**

- `pageSize` clamped to `MAX_PAGE_SIZE`
- response bytes cap enforced strictly

**Stable id (cursor request key)**

- `k = sha256hex("v1|vscode.lsp.diagnostics.workspace")`

---

## 8. Schema requirements

For each tool:

- Input schema MUST reject unknown fields (`additionalProperties: false`).
- Input schema MUST define required fields and types consistent with this contract (including paging fields for paged tools).
- Schemas MUST reflect the determinism choices in this contract (flattened document symbols; workspace diagnostics paging by file groups).

Schema locations (v1):

- Input schemas live at:
  - `schemas/tools/<toolname>.json`

- Output schemas live at:
  - `schemas/tools/<toolname>.output.json`

Output schemas MUST match the outputs described in §7 and MUST be versioned/documented alongside any contract change.

---

## 9. Versioning and compatibility

- v1 is defined by the tool set and contract in this file.
- Any contract change requires:
  - updating this file
  - updating schemas
  - updating tests that validate tool output stability and limits

Fail-closed behavior is required: if an input cannot be validated or safely processed deterministically, the server MUST reject it with a deterministic error.
