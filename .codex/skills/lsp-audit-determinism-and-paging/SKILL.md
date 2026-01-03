---
name: lsp-audit-determinism-and-paging
description: >-
  Audit determinism for list/search endpoints using rg + VS Code LSP to locate cursor/page/limit/sort logic,
  verify stable sort and dedupe keys, cursor semantics, caps, and error handling. Use for pagination, cursor
  tokens, list/search APIs, or LSP list tools. Keywords include cursor, page, limit, offset, token, sort,
  stable, deterministic, dedupe, canonical, snapshot, and rg.
---

# LSP Audit: Determinism and Paging

## Purpose

Deliver a deterministic paging contract audit for list/search APIs using rg recon followed by LSP confirmation.

## Inputs

Required:

- API or endpoint names to audit, or the keywords: cursor/page/limit/token/sort

Optional:

- File or module hints if the symbol space is large
- Specific tools to include/exclude

## Outputs

- Per-API paging contract summary covering inputs, sort keys, cursor composition, caps/limits, invalid-cursor errors, and symbol locations

## Procedure (rg recon -> LSP confirm)

1. Recon with rg to find paging hotspots:
   - `rg -n "\\b(cursor|pageSize|nextCursor|limit|offset)\\b" src/`
   - `rg -n "\\b(stable|deterministic|sort|dedup|canonical)\\b" src/`
   - If cursors are encoded: `rg -n "\\b(base64|sha256|snapshot|opaque)\\b" src/`
   - Collect top candidate APIs and helper modules (cursor encode/decode, sorting, stable stringify).
2. For each candidate API (LSP):
   - `workspaceSymbols` to locate the public surface (handler or endpoint function).
   - `definition` to locate implementation and paging logic.
   - `references` to find call sites and variants.
3. Confirm determinism chain:
   - Identify sort keys and dedupe keys; verify stable/canonical fields.
   - Trace cursor composition and validation.
   - Identify hard caps and invalid-cursor error behavior.
4. Produce a per-API summary with symbol locations.

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
