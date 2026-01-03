---
name: lsp-triage-error-to-root-cause
description: >-
  Triage error messages, diagnostics, exceptions, or TypeScript/compile errors using rg + VS Code LSP to locate
  origin sites, trace callers, and identify the likely contract or type boundary. Use when given an error
  string, log line, or diagnostic (optionally with file/line) and you need a short root-cause note with
  evidence locations. Keywords include error, exception, fails, stack, diagnostic, TypeScript error, compile
  error, rg, and ripgrep.
---

# LSP Triage Error To Root Cause

## Overview

Locate the throwing or failing site via rg, follow the call chain to the nearest contract boundary, and summarize likely fix vectors with evidence.

## Inputs

- Error text or diagnostic snippet
- Optional file and line for a direct starting point

## Workflow (rg recon -> LSP confirm)

1. Recon with rg (preferred when you have an error string):
   - Exact message: `rg -n -F "<exact error text>"`
   - Error codes/enums: `rg -n "\\b<MODULE>/(NOT_FOUND|INVALID_PARAMS|CAP_EXCEEDED)\\b"`
   - Stack function names: `rg -n "\\b<functionName>\\b" src/ test/`
2. Start point (LSP):
   - If file/line is provided, start there; otherwise jump to the best rg hit and use `vscode_lsp_hover` to confirm context.
   - Use `vscode_lsp_definition` at the failing site to jump to the callee or symbol definition.
3. Use `vscode_lsp_references` to trace callers. Keep the call chain slice bounded (top 3-6 hops) and prefer the most relevant callers.
4. Boundary capture:
   - Use `vscode_lsp_hover` to record expected vs actual types/params.
   - Identify the smallest contract boundary where the wrong thing crosses.
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
