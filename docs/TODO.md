## TODOs

- Add position-bounds validation for `vscode_lsp_hover` and `vscode_lsp_references` before provider calls; return `MCP_LSP_GATEWAY/NOT_FOUND` when out-of-range.
- Add unit tests covering out-of-range positions for hover and references, asserting JSON-RPC error `-32603` with data code `MCP_LSP_GATEWAY/NOT_FOUND`.
- Add a unit test that forces a non-hover tool response to exceed `maxResponseBytes` to confirm deterministic `MCP_LSP_GATEWAY/CAP_EXCEEDED`.

## Selection criteria for “packaged, works anywhere” LSP skills

A skill is practical across repos when it:

- Starts from inputs users can always provide: **symbol name**, **file URI**, **error message**, **requirement text**, **query string**.
- Uses only these stable building blocks:
  - `workspaceSymbols` / `documentSymbols` to find anchors
  - `definition` / `references` to build trace graphs
  - `hover` to confirm types/params
  - `diagnostics.*` to confirm breakage and locate failure sites

- Enforces deterministic bounds:
  - fixed `pageSize` (e.g., 25–50)
  - max pages / max items
  - stable sorting in its report (uri, start line, symbol name)

---

Repo level skills

.codex/
└── skills/
├── README.md # Overview of the skill pack
├── vscode-lsp-gateway.trace.requirement-to-implementation/
│ ├── SKILL.md
│ ├── references/
│ │ └── example-traces.md
│ └── assets/
│ └── output-template.json
├── vscode-lsp-gateway.audit.security-boundary/
│ ├── SKILL.md
│ └── references/
│ └── common-guard-patterns.md
├── vscode-lsp-gateway.audit.determinism-and-paging/
│ ├── SKILL.md
│ └── references/
│ └── pagination-antipatterns.md
├── vscode-lsp-gateway.audit.schema-runtime-consistency/
│ ├── SKILL.md
│ └── references/
│ └── schema-validation-frameworks.md
├── vscode-lsp-gateway.triage.error-to-root-cause/
│ ├── SKILL.md
│ └── references/
│ └── error-classification-guide.md
└── vscode-lsp-gateway.map.feature-surface/
├── SKILL.md
└── references/
└── architecture-visualization-tips.md

## Recommended portable skill catalog (v1, rg-first)

### 1) `lsp-trace-requirement-to-implementation`

**Concrete application:** “Where is this behavior implemented and tested?”

**Description (routing keywords):** Trace a requirement/spec string to code + tests using fast text search (rg) and LSP symbols/definitions/references (keywords: spec, contract, requirement, invariant, behavior, error string, test, implementation, rg, ripgrep, grep).

**Inputs:** requirement text + 3–10 keywords (and/or exact identifiers, error strings)

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg):**
   - If you have an **exact string** (header name, error code, flag): `rg -n -F "<literal>"`.
   - If you have identifiers: `rg -n "\b<IdentA>\b|\b<IdentB>\b"` (regex word boundaries).
   - If you have a doc/spec phrase: `rg -n "<phrase>" docs/ README* **/*.md` (scope to docs first).
   - Capture **top N files** (cap: ~20–30) with the most relevant hits; prefer hits in:
     - entrypoints (`src/`, `cmd/`, `server/`, etc.)
     - validators/routers
     - tests (`test/`, `__tests__/`, etc.)

1. **Seed anchors (LSP):**
   - Convert the best rg hits into **symbol-ish** keywords (function names, classes, constants).
   - Run `workspaceSymbols` for each seed keyword; pick top candidate anchors (cap N=25 total).

2. **Trace:**
   - For each anchor: `definition` → open target symbol.
   - `references` (paged) to find call sites / usage.
   - Use `hover` at key call sites to confirm parameter/return expectations and any subtle contract behavior.

3. **Report (bounded):**
   - “Requirement anchors” (symbols + locations)
   - “Primary implementation path” (top 5–15 nodes)
   - “Tests / assertions” (classify by folder patterns observed; do not assume naming conventions)

**Output:** structured list of `(symbol, uri, range, role: spec|impl|test, notes)`.

---

### 2) `lsp-audit-security-boundary`

**Concrete application:** “Prove the security gates exist and identify bypass surfaces.”

**Description:** Identify and trace security enforcement points using rg + LSP (keywords: auth, authenticate, authorize, token, secret, validate, sanitize, redact, origin, csrf, permission, guard, rg, ripgrep).

**Inputs:** guard keywords + optional entrypoint symbol(s) or HTTP route names

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg) to build the “guard shortlist”:**
   - Broad pass (scoped): `rg -n "\b(auth|authenticate|authorize|token|secret|redact|sanitize|validate|origin|csrf)\b" src/`
   - Targeted pass for your project’s namespace conventions (examples):
     - error codes: `rg -n "WORKSPACE_DENIED|URI_INVALID|INVALID_PARAMS|CAP_EXCEEDED"`
     - header checks: `rg -n -F "Authorization"`, `rg -n -F "Origin"`, etc.

   - From hits, extract candidate **guard functions** and **enforcement chokepoints** (router, middleware, validators).

1. **Confirm guards are real guards (LSP):**
   - `workspaceSymbols` for each candidate guard symbol; open definitions.
   - Use `references` to enumerate enforcement sites (paged, bounded).

2. **Build “bypass map”:**
   - Follow `definition` from entrypoints into guard calls.
   - Identify callers that appear to perform sensitive work **without** passing through guards (e.g., alternate router paths, helper entrypoints, tests that bypass).

3. **Summarize as a deterministic “guard surface map”:**
   - Guard symbol → enforced at → protects what input/output → potential bypass (with evidence locations)

**Output:** deterministic guard map table with evidence locations.

---

### 3) `lsp-audit-determinism-and-paging`

**Concrete application:** “Does this repo’s pagination/cursor logic produce stable results?”

**Description:** Audit determinism for list/search endpoints using rg + LSP (keywords: cursor, page, limit, offset, token, sort, stable, deterministic, dedupe, canonical, snapshot, rg).

**Inputs:** names of list/search APIs (or “cursor/page/limit”)

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg) to find paging hotspots quickly:**
   - `rg -n "\b(cursor|pageSize|nextCursor|limit|offset)\b" src/`
   - `rg -n "\b(stable|deterministic|sort|dedup|canonical)\b" src/`
   - If cursors are encoded: `rg -n "\b(base64|sha256|snapshot|opaque)\b" src/`
   - Collect top candidate APIs and the helper modules they rely on (cursor encode/decode, sorting, stable stringify).

1. **Per candidate API (LSP):**
   - `workspaceSymbols` to locate the public surface (handler function / endpoint function).
   - `definition` to locate implementation and paging logic.
   - `references` to find all call sites and variants.

2. **Confirm determinism chain:**
   - Find sort keys and dedupe keys (verify they use stable/canonical fields).
   - Trace cursor composition/validation.
   - Identify hard caps / error behavior for invalid cursor or too-large result sets.

**Output:** per-API structured summary: inputs accepted, sort keys, cursor semantics, caps, invalid-cursor behavior (with symbol locations).

---

### 4) `lsp-audit-schema-runtime-consistency`

**Concrete application:** “Do schemas/docs/tests match runtime accepts/returns?”

**Description:** Cross-check schema definitions against runtime validation and serialization using rg + LSP (keywords: schema, validate, parse, serialize, request, response, contract, ajv, zod, openapi, json schema, rg).

**Inputs:** schema entry names or schema keywords; optional method/endpoint/tool name

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg) to stitch the schema ↔ runtime graph:**
   - Locate schema files / validators: `rg -n "\b(schema|validate|validator|ajv|zod|joi|openapi)\b" src/ schemas/ docs/`
   - If you know a tool/method name: `rg -n -F "<toolOrMethodName>" src/ schemas/ docs/ test/`
   - Extract:
     - schema definition locations
     - validator instantiation locations
     - handler/dispatcher locations

1. **LSP trace for correctness (avoid name-based inference):**
   - From schema type/definition symbols: `references` to find usage sites.
   - From handler surface: `definition`/`references` back to schema types and validators.

2. **Identify drift:**
   - fields present in runtime but absent in schema (or vice versa)
   - tests missing for required fields / error mapping

**Output:** drift findings list with `(field/symbol, expected, observed, evidence)`.

---

### 5) `lsp-triage-error-to-root-cause`

**Concrete application:** “Given an error message, find throwing site, callers, likely fix.”

**Description:** Triage an error/diagnostic using rg to locate origin sites and LSP to trace call chains and type boundaries (keywords: error, exception, fails, stack, diagnostic, TypeScript error, compile error, rg, ripgrep).

**Inputs:** error text/diagnostic snippet; optional file/line

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg) (preferred when you have an error string):**
   - Exact message: `rg -n -F "<exact error text>"`
   - If error codes / enums: `rg -n "\b<MODULE>/(NOT_FOUND|INVALID_PARAMS|CAP_EXCEEDED)\b"`
   - If stack shows function names: `rg -n "\b<functionName>\b" src/ test/`

1. **Start point (LSP):**
   - If file/line: start there; otherwise jump to best rg hit and use `hover` to confirm context.
   - Use `definition` at the failing site and `references` to find callers.

2. **Boundary capture:**
   - Use `hover` to record expected vs actual types/params.
   - Identify the smallest contract boundary where “wrong thing crosses” (wrong type, missing guard, wrong overload, missing normalization).

**Output:** short structured incident note: origin site(s), bounded call chain slice, likely fix vectors, evidence locations.

---

### 6) `lsp-map-feature-surface`

**Concrete application:** “Map a subsystem: entrypoints, core types, hotspots.”

**Description:** Build a bounded feature map using rg to seed the surface area and LSP to rank symbols by usage (keywords: overview, map, architecture, entrypoint, module, subsystem, surface, export, public API, rg).

**Inputs:** query string (module/feature name) + optional file/folder focus

**Procedure (rg recon → LSP confirm):**

0. **Recon (rg) to find the “surface” quickly:**
   - Find mentions of the feature/module name: `rg -n "\b<feature>\b" src/`
   - If the repo has barrel exports / public API modules: `rg -n "\b(export\s+(\{|\*|class|function|interface|type))\b" src/`
   - Identify candidate “public surface” files (index.ts, public.ts, api.ts, commands, router modules).

1. **LSP map:**
   - `workspaceSymbols` for the feature query; take top N symbols.
   - For each: `definition`, then `references` count (paged, bounded).
   - Rank by “reference density” (deterministic tie-breakers: uri/range/name).

2. **Output:**
   - top entrypoints
   - core types/interfaces
   - hotspot files

**Output:** deterministic feature map list + hotspot summary.

---

## Portable “rg recon” rules you can reuse across all skills

- Prefer **literal** searches when you can (`rg -F`) to avoid regex surprises.
- Bound the blast radius:
  - scope paths (`src/`, `test/`, `docs/`) before whole-repo scans
  - rely on `.gitignore` (rg does by default)
  - cap results by selecting only the top ~20–30 files/hits for deeper LSP tracing

- Use rg outputs as **seeds**, not proof:
  - rg finds strings/comments/docs/tests; LSP confirms semantics (symbol identity, call edges, types).

If you want, I can also rewrite the **single-line `description` fields** to be maximally non-overlapping (routing-safe) while adding “rg/grep/ripgrep” keywords in a way that doesn’t cause the skills to cannibalize each other.

## How your original A–D list maps

Your four are absolutely viable as portable skills with small naming/scope tweaks:

- **A) contract-to-impl trace** → keep (rename to `lsp_trace_requirement-to-implementation`)
- **B) security boundary audit** → keep (`lsp_audit_security-boundary`)
- **C) determinism & paging audit** → keep (`lsp_audit_determinism-and-paging`)
- **D) schema ↔ runtime consistency** → keep (`lsp_audit_schema-runtime-consistency`)

Add two “real-world daily drivers”:

- `lsp_triage_error-to-root-cause`
- `lsp_map_feature-surface`

That gives you a balanced, credible, portable “starter pack” of skills.

---

## Practical packaging guidance (minimal, best-practice aligned)

When you package these in your GitHub repo:

- Keep each skill **narrow** and **independent**; no monolithic “Audit Pack” procedure.
- Make `description` single-line and keyword-rich so routing works across repos.
- In every skill, hard-code bounds (example defaults):
  - `pageSize: 25`
  - `maxPages: 10`
  - `maxSymbols: 25`
  - `maxFindings: 50`

- Standardize outputs to a simple schema (so users can compare results across skills):
  - `findings[]: {category, symbol, uri, range, evidence, severity, notes}`

## When to use

- Investigating security enforcement: "Where are authentication checks enforced in the API layer?"
- Security review preparation: "Map all authorization boundary checks before the audit."
- Identifying potential vulnerabilities: "Find endpoints that might bypass input validation."

### IDE context

If running in Codex IDE and specific files are open, the skill will prioritize analyzing guard usage within those files first before expanding to workspace-wide analysis.

### CLI context

If running in Codex CLI, you should specify the module or subsystem to analyze using path hints: "Audit security boundaries in @src/api" or provide entrypoint symbols explicitly: "Trace guards from the createUser function."

```

This pattern acknowledges that the IDE provides richer ambient context while the CLI requires more explicit scoping, and it helps users understand how to get optimal results in each environment.

## Testing and Validation Strategy

Before finalizing these skills, you should create a testing protocol that validates each skill against the quality checklist from the best practices guide. Here's a concrete testing approach:

For each skill, write three test scenarios that should trigger it and three that should not. Run these through Codex and observe the routing behavior. If you find inconsistent triggering, that's a signal that the description needs keyword adjustments or boundary clarifications.

For example, for `lsp.map.feature-surface`:

**Should trigger:**
- "Give me an overview of the authentication subsystem"
- "Map the key entry points for the payment processing module"
- "What are the main types and interfaces in the API layer?"

**Should not trigger:**
- "Add logging to the authentication functions" (this is modification, not mapping)
- "Why is the payment processing slow?" (this is performance analysis, not surface mapping)
- "Refactor the API layer to use async/await" (this is transformation, not discovery)

Document these test cases in a `docs/testing/skill-routing-tests.md` file so that future maintainers can validate behavior as the skills evolve.

## Packaging and Documentation Strategy

Your skills should ship with a three-tier documentation structure:

**Tier 1: Quick reference** (in each SKILL.md's summary field)
A single sentence capturing the core use case: "Maps requirement text to implementation and test locations."

**Tier 2: User-facing guide** (in a `docs/skills-guide.md`)
A friendly explanation of when to use each skill with real-world scenarios and example prompts. This is where you tell the story of how these skills solve actual engineering problems.

**Tier 3: Implementation details** (in each SKILL.md's body)
The full procedure, prerequisites, failure modes, and technical specifications. This is for power users who want to understand exactly what's happening.

This structure lets users progressively discover depth as they need it, which aligns perfectly with how the skills system itself uses progressive disclosure.

## Repository Structure Recommendation

Based on the best practices guide and your codebase, here's how I'd structure the skills in your repository:
```
