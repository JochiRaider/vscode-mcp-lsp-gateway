---
name: lsp-trace-requirement-to-implementation
description: Trace a requirement/spec string or error text to code + tests using rg plus VS Code LSP (symbols/definition/references/hover). Use for questions like "where is this behavior implemented and tested?" and requests involving spec/contract/invariant text, headers, error codes, or tool behaviors. Keywords: requirement, spec, contract, behavior, invariant, error, test, implementation, rg, ripgrep, grep.
---

# Lsp Trace Requirement To Implementation

## Purpose

Trace a requirement/spec statement to concrete implementation symbols and tests using rg recon first, then LSP navigation.

## Inputs

Provide:

- Requirement or spec text (exact string or paraphrase).
- 3 to 10 keywords or exact identifiers/error strings.

Optional:

- Paths/modules to scope search when the repo is large.
- Output detail preference (short vs detailed trace).

## Output format

Return a structured list of:

`(symbol, uri, range, role: spec|impl|test, notes)`

## Procedure (rg recon -> LSP confirm)

1. Ask for missing requirement text or keywords before proceeding.
2. Recon with rg:
   - Exact string: `rg -n -F "<literal>"`
   - Identifiers: `rg -n "\\b<IdentA>\\b|\\b<IdentB>\\b"`
   - Doc/spec phrase: `rg -n "<phrase>" docs/ README* **/*.md`
   - Capture top ~20 to 30 relevant hits; prefer entrypoints and validators in `src/` and tests in `test/`.
3. Convert best rg hits into symbol-ish seeds (function/class/constant names).
4. Run `workspaceSymbols` for each seed and choose top candidate anchors (cap 25 total).
5. For each anchor, use `definition` to open the target symbol.
6. Use `references` (paged) to find call sites; include declaration only when needed.
7. Use `hover` on key call sites to confirm parameter/return expectations and subtle behavior.
8. Classify findings:
   - `spec`: requirement/docs locations
   - `impl`: primary implementation path
   - `test`: locations under test folders
9. Produce the structured report and note gaps or ambiguous matches.

## Verification

Confirm that:

- At least one anchor resolved to a concrete symbol.
- Implementation path has 5 to 15 nodes with stable, deduped locations.
- Tests are identified via folder patterns, not assumptions.

## Failure modes

- No symbol matches: ask for tighter keywords or exact identifiers.
- Too many matches: ask for narrower paths or specific modules.
- Empty references: fall back to nearby symbols or confirm workspace indexing.
