---
name: lsp-audit-security-boundary
description: Map and verify security enforcement points using LSP navigation (symbols, references, definitions) to prove authn/authz, validation, origin checks, URI gating, and redaction. Use for security boundary audits, guard-rail verification, and bypass surface analysis (keywords: auth, validate, sanitize, redact, token, secret, permission). Produces a deterministic guard map table with evidence locations.
compatibility: Works in Codex CLI and Codex IDE. Requires LSP tools and read access only. No network required.
metadata:
  owner: askahn
  version: "0.1"
  maturity: draft
  short-description: LSP-based security guard map
license: Proprietary
---

# LSP Security Boundary Audit

## Purpose

Produce a deterministic "guard surface map" that proves where security gates are enforced and where bypasses might exist.

## When to use

- Verify security enforcement in a codebase using LSP traceability rather than grep
- Identify bypass surfaces for auth, validation, origin checks, URI gating, or redaction
- Produce evidence-linked guard maps for review checklists

## Inputs

Required:

- Guard keywords (default set: auth, validate, sanitize, redact, token, secret, permission)

Optional:

- Entrypoint symbol names (e.g., router handlers, server start functions)
- Scope constraints (paths or modules to focus on)

## Outputs

- Deterministic guard map table: guard symbol -> enforced at -> protects -> potential bypass -> evidence locations

## Prerequisites

System requirements:

- LSP tool access (workspaceSymbols, references, definition)

Permissions required:

- Read-only access to workspace files

## Procedure

1. If running in IDE and a selection or active file is present, treat it as the initial scope. In CLI, ask for 1-3 likely paths if scope is unclear.
2. Use `workspaceSymbols` with guard keywords to collect candidate guard symbols. Record symbol name, kind, and location.
3. For each guard symbol, use paged `references` to identify all call sites. Collect locations and enclosing symbols.
4. Follow key call chains with `definition` to confirm what the guard actually enforces (avoid name-only inference).
5. Identify entrypoints that do not flow through any guard. Mark these as potential bypasses.
6. Produce the guard map table with stable ordering (sort by guard symbol name, then by location path and position).

## Verification

Confirm:

- Each guard symbol in the map has at least one evidence location
- Output ordering is stable and deterministic across runs
- Potential bypasses list only entrypoints with no guard call path

## Failure modes

- Too many irrelevant symbols: narrow keywords or add entrypoint scope
- Missing references due to symbol indexing: open the file in IDE or retry after indexing completes
- Ambiguous enforcement: follow additional `definition` hops until the enforced condition is clear

## Examples

### Should trigger

- "Map auth and validation guards in this server and show bypass surfaces."
- "Use LSP references to prove where origin checks and URI gating happen."
- "Generate a guard surface map for auth/redaction in this extension."

### Should NOT trigger

- "Explain how authentication works in general."
- "Refactor this function for readability."
- "Write unit tests for this module."

## Resources

- None
