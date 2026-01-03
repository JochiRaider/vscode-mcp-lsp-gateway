---
name: lsp-triage-error-to-root-cause
description: Triage error messages, diagnostics, exceptions, or TypeScript/compile errors by locating the origin site, tracing callers with LSP, and identifying the likely contract or type boundary; use when given an error string, log line, or diagnostic (optionally with file/line) and you need a short root-cause note with evidence locations.
---

# LSP Triage Error To Root Cause

## Overview

Locate the throwing or failing site, follow the call chain to the nearest contract boundary, and summarize likely fix vectors with evidence.

## Inputs

- Error text or diagnostic snippet
- Optional file and line for a direct starting point

## Workflow

1. If file/line is provided, start there. Otherwise, use `vscode_lsp_workspaceSymbols` with keywords from the error text (symbol names, function names, error codes).
2. At the suspected failing usage site, run `vscode_lsp_definition` to jump to the callee or symbol definition.
3. Use `vscode_lsp_references` on that symbol to trace how it is called. Keep the call chain slice bounded (top 3-6 hops) and prefer the most relevant callers.
4. Use `vscode_lsp_hover` at the boundary to capture expected vs actual types, parameters, or contracts.
5. If the error is a type/diagnostic, confirm with `vscode_lsp_diagnostics_document` or `vscode_lsp_diagnostics_workspace` to ensure the failure is still present.
6. Summarize the likely root cause and fix vectors with evidence locations.

## Output Format

Return a short incident note with:

- Origin site(s): file path and line with the failing site
- Call chain slice: bounded list of callers leading to the origin
- Boundary evidence: hover/type or contract details showing mismatch
- Likely fix vectors: concise hypotheses (wrong type passed, missing null check, wrong overload, etc.)

Example (structure only):

```
Origin: src/foo.ts:123 (throws Error("...") in doThing)
Call chain: src/bar.ts:88 -> src/foo.ts:100 -> src/foo.ts:123
Boundary evidence: doThing expects Foo | null, caller passes string
Likely fix vectors: add null check, adjust caller to pass Foo, update overload selection
```

## Notes

- Prefer deterministic evidence: exact symbol definitions, references, and hover signatures.
- Keep the call chain short and actionable.
