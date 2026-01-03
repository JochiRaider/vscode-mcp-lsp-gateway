---
name: lsp-audit-security-boundary
description: >-
  Identify and trace security enforcement points using rg + VS Code LSP to prove authn/authz, validation,
  origin checks, URI gating, and redaction, and to surface potential bypasses. Use for security boundary
  audits and guard-rail verification. Keywords include auth, authenticate, authorize, token, secret, validate,
  sanitize, redact, origin, csrf, permission, guard, rg, and ripgrep.
---

# Lsp Audit Security Boundary

## Purpose

Prove security gates exist and identify bypass surfaces using rg recon followed by LSP validation.

## Inputs

Provide:

- Guard keywords (default set: auth, authenticate, authorize, token, secret, validate, sanitize, redact, origin, csrf, permission, guard).

Optional:

- Entrypoint symbol names or HTTP route names.
- Paths/modules to scope search.

## Output format

Return a deterministic guard map table:

`guard symbol -> enforced at -> protects what -> potential bypass -> evidence locations`

## Procedure (rg recon -> LSP confirm)

1. Recon with rg to build a guard shortlist:
   - Broad pass: `rg -n "\\b(auth|authenticate|authorize|token|secret|redact|sanitize|validate|origin|csrf)\\b" src/`
   - Targeted pass (project conventions):
     - Error codes: `rg -n "WORKSPACE_DENIED|URI_INVALID|INVALID_PARAMS|CAP_EXCEEDED"`
     - Header checks: `rg -n -F "Authorization"`, `rg -n -F "Origin"`
   - From hits, extract candidate guard functions and enforcement chokepoints (router/middleware/validators).
2. Confirm guards are real guards with LSP:
   - Run `workspaceSymbols` for each candidate guard symbol; open definitions.
   - Use paged `references` to enumerate enforcement sites.
3. Build the bypass map:
   - Follow `definition` from entrypoints into guard calls.
   - Identify callers that handle sensitive work without passing through guards.
4. Summarize as a deterministic guard surface map with evidence locations.

## Verification

Confirm that:

- Each guard symbol has evidence locations.
- Output ordering is stable and deterministic.
- Bypass list only includes entrypoints with no guard call path.

## Failure modes

- Too many irrelevant hits: narrow keywords or add scope paths.
- Missing references: confirm LSP indexing or open the file before retrying.
- Ambiguous enforcement: follow additional `definition` hops.
