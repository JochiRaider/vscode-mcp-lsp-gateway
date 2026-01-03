---
name: lsp-audit-determinism-and-paging
description: Audit determinism for paged or list-returning APIs by locating cursor/page/limit/sort logic, verifying stable sort and dedupe keys, cursor semantics, caps, and error handling. Use for pagination, cursor tokens, list/search endpoints, LSP list tools. Produces per-API paging contract summaries with symbol locations.
---

# LSP Audit: Determinism and Paging

## Purpose

Deliver a deterministic paging contract audit for list/search APIs, including stable sort, dedupe, cursor composition, caps, and invalid-cursor behavior, with symbol locations.

## When to use

- Auditing pagination/cursor stability or determinism
- Reviewing list/search endpoints (cursor/page/limit/token/sort)
- Checking LSP list-like tools for stable ordering and caps

## Inputs

Required:

- API or endpoint names to audit, or the keywords: cursor/page/limit/token/sort

Optional:

- File or module hints if the symbol space is large
- Specific tools to include/exclude

## Outputs

- Per-API paging contract summary covering inputs, sort keys, cursor composition, caps/limits, invalid-cursor errors, and symbol locations

## Prerequisites

System requirements:

- Access to the repo and LSP tool surface (workspace symbols, definition, references)

Permissions required:

- Read-only access to source files

## Procedure

1. Find candidate list/search APIs by running `workspaceSymbols` for: cursor, page, limit, token, sort, list, search.
2. For each candidate API, use `definition` to locate the implementation entrypoint.
3. Use `references` to discover variants, call sites, and cursor encode/decode helpers.
4. Trace sorting and dedupe paths; confirm stable sort keys and deterministic ordering.
5. Identify caps (max items/bytes/timeouts) and invalid cursor error behavior.
6. Produce a paging contract summary per API with file paths and symbol locations.

## Verification

- Cursor encode/decode logic is identified and linked to the API entrypoint.
- Sorting and dedupe are explicit and stable; caps are enforced and documented.

## Failure modes

- No symbols found: broaden search terms or ask for API names.
- Multiple implementations: list each variant separately and note selection rules.
- Ambiguous cursor format: ask for the expected cursor schema or locate tests/docs.

## Examples

### Should trigger

- "Audit cursor stability for our workspaceSymbols paging."
- "Does the list API have a stable sort and deterministic cursor?"
- "Find limit/page token handling for search endpoints and summarize caps."

### Should NOT trigger

- "Add pagination to this endpoint."
- "Explain how cursors work in general."
- "Refactor this file for readability."
