---
name: lsp-trace-requirement-to-implementation
description: Trace a requirement/spec string to code locations and tests using VS Code LSP tools (symbols, definitions, references, hover). Use for questions like "where is this behavior implemented and tested?" (keywords: requirement, spec, contract, behavior, invariant, error code, test, implementation).
---

# Lsp Trace Requirement To Implementation

## Purpose

Produce an implementation trace from requirement text to concrete symbols, call sites, and tests using LSP-driven navigation.

## When to use

- Use when you have a spec/contract statement or error string and need to locate the implementation and tests.
- Use when you need a concise, evidence-backed trace through symbols, definitions, and references.

## Inputs

Required:

- Provide requirement/spec text (exact string or paraphrase).
- Provide 3 to 10 keywords or exact identifiers/error strings.

Optional:

- Provide target paths or module names (if the workspace is large).
- Provide output format preferences (e.g., short vs detailed trace).

## Outputs

Return a structured report of anchors, implementation path, and tests as a list of:
`(symbol, uri, range, role: spec|impl|test, notes)`

## Procedure

1. If requirement text or keywords are missing, ask for them before proceeding.
2. If running in CLI and the target area is unclear, ask for 1 to 3 candidate paths or modules.
3. Use `workspaceSymbols` for each keyword and collect top candidate anchors (cap around 25 total).
4. For each anchor, resolve `definition` and open the target symbol.
5. Run `references` (paged) to find call sites; include declaration only when needed.
6. Use `hover` at key call sites to confirm parameter/return expectations or error semantics.
7. Classify findings into roles:
   - `spec`: locations of requirements or documented behavior
   - `impl`: primary implementation path
   - `test`: references under test folders
8. Produce the structured report and note any gaps or ambiguous matches.

## Verification

Confirm that:

- At least one anchor was resolved to a concrete symbol.
- Implementation path includes 5 to 15 nodes with stable, deduped locations.
- Tests are identified by folder patterns, not assumptions.

## Failure modes

- If no symbol matches, ask for tighter keywords or exact identifiers.
- If too many matches, ask for narrowing paths or specific modules.
- If LSP returns empty references, fall back to nearby symbols or confirm workspace indexing.

## Examples

### Should trigger

- "Where is the 'local-only bind' requirement implemented and tested?"
- "Trace error code MCP-401 to implementation and tests."
- "Find where the 'maxItemsPerPage' cap is enforced."

### Should NOT trigger

- "Refactor this file for readability."
- "Explain how JSON-RPC works."
- "Write unit tests for this function."
