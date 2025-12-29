# SCHEMA.md - Tool Schemas and Governance (v1)

This document defines the authoritative conventions for MCP tool schemas in this repo.
It exists to keep schemas stable, strict, and easy for GPT-5.2-Codex style harnesses to consume.

Source-of-truth hierarchy:
1. docs/PROTOCOL.md (transport and lifecycle)
2. docs/SECURITY.md (trust boundaries and enforced controls)
3. docs/CONTRACT.md (tool behavior, determinism, caps, error taxonomy)
4. This file (schema conventions and file layout)

## 1. Scope

This file governs:
- Tool argument schemas (inputSchema)
- Tool result schemas (outputSchema) for structuredContent
- How schema changes are made, reviewed, and validated

This file does not restate tool behavior, paging rules, or security policy. Those live in CONTRACT and SECURITY.

## 2. JSON Schema dialect

- Dialect: JSON Schema Draft 2020-12.
- Every schema file MUST set `$schema` explicitly to avoid dialect ambiguity.

## 3. File layout

Inputs (authoritative for tools/call arguments):
- schemas/tools/<toolName>.json

Outputs (authoritative for tools/call structuredContent):
- schemas/tools/<toolName>.output.json

Rationale:
- Keeps v1 input schema filenames stable.
- Allows incremental adoption of outputSchema without renaming existing files.

## 4. Required invariants (all schemas)

All tool schemas MUST:
- Use a root object schema: `"type": "object"`
- Set `"additionalProperties": false`
- Prefer explicit `"required": [...]` for every non-optional property
- Avoid defaults and coercion assumptions
- Keep descriptions short and non-sensitive

## 5. Input schema conventions

### 5.1 Common fields

When a tool operates on a file location:
- Use `uri` (string) and `position` (object: line, character)
- `uri` is a `file:` URI (no raw paths)
- Line and character are 0-based integers with minimum 0

When a tool supports paging:
- Use `cursor` (string, nullable only if you explicitly support null in the contract)
- Use `pageSize` (integer) bounded to the v1 max page size

### 5.2 Encode caps in schemas

Where practical, encode contract caps into schemas:
- `pageSize`: maximum = v1 maxItemsPerPage
- query strings: maxLength (bounded, deterministic)
- arrays: maxItems (bounded, deterministic)

If a value exceeds a schema cap, treat it as INVALID_PARAMS, not CAP_EXCEEDED.
CAP_EXCEEDED is reserved for runtime caps (timeouts, response bytes, total-set caps).

## 6. Output schema conventions

### 6.1 structuredContent is the contract payload

For v1 tools, successful tools/call returns:
- `structuredContent`: tool-specific object (this is what outputSchema describes)
- `content`: a minimal text summary for debugging and non-JSON UIs

Output schemas should:
- Be root objects with additionalProperties false
- Prefer stable arrays of objects (avoid free-form maps unless required)
- Use deterministic field names and stable nesting

### 6.2 Optional summary field

If you include a `summary` string in structuredContent, it should be:
- Short
- Non-sensitive
- Deterministic (derived from structured content only)

## 7. Reuse and $ref policy

Prefer simple schemas per tool.
If you introduce shared definitions:
- Put them behind `$defs` inside the same schema file first.
- Only introduce cross-file `$ref` if you also add a build step that bundles schemas into self-contained objects.

## 8. Schema change workflow

Any schema change MUST be accompanied by:
- Corresponding updates in docs/CONTRACT.md (if behavior or shapes change)
- Test updates that assert:
  - tools/list includes the exact schemas
  - invalid inputs fail with INVALID_PARAMS
  - outputs conform to outputSchema (at least in unit tests)

If a change is not testable, it is not ready to merge.
