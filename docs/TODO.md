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
    ├── README.md                           # Overview of the skill pack
    ├── vscode-lsp-gateway.trace.requirement-to-implementation/
    │   ├── SKILL.md
    │   ├── references/
    │   │   └── example-traces.md
    │   └── assets/
    │       └── output-template.json
    ├── vscode-lsp-gateway.audit.security-boundary/
    │   ├── SKILL.md
    │   └── references/
    │       └── common-guard-patterns.md
    ├── vscode-lsp-gateway.audit.determinism-and-paging/
    │   ├── SKILL.md
    │   └── references/
    │       └── pagination-antipatterns.md
    ├── vscode-lsp-gateway.audit.schema-runtime-consistency/
    │   ├── SKILL.md
    │   └── references/
    │       └── schema-validation-frameworks.md
    ├── vscode-lsp-gateway.triage.error-to-root-cause/
    │   ├── SKILL.md
    │   └── references/
    │       └── error-classification-guide.md
    └── vscode-lsp-gateway.map.feature-surface/
        ├── SKILL.md
        └── references/
            └── architecture-visualization-tips.md


## Recommended portable skill catalog (v1)

### 1) `lsp_trace_requirement-to-implementation`

**Concrete application:** “Where is this behavior implemented and tested?” Works for protocols, business rules, CLI flags, config defaults, error codes, etc.

**Description (routing keywords):** Trace a requirement/spec string to code locations and tests using workspace symbols, definitions, and references (keywords: spec, contract, requirement, behavior, invariant, test, implementation).

**Inputs:** requirement text + 3–10 keywords (or exact identifiers / error strings)

**Procedure (LSP-driven):**

1. `workspaceSymbols` for each keyword; pick top candidate anchors (cap N=25).
2. For each anchor: `definition` → open target symbol; `references` (paged) to find call sites.
3. Use `hover` at key call sites to confirm parameter/return expectations.
4. Produce a report:
   - “Requirement anchors” (symbols + locations)
   - “Primary implementation path” (top 5–15 nodes)
   - “Tests / assertions” (any references under common test paths, but _don’t assume_ names—just classify by folder patterns)

**Output:** structured list of `(symbol, uri, range, role: spec|impl|test, notes)`.

Why it’s worth shipping: it’s the most common “day-2 engineering” action in any repo.

---

### 2) `lsp_audit_security-boundary`

**Concrete application:** “Prove the security gates exist and identify bypass surfaces.” Works in servers, CLIs, agents, plugins, and SDKs.

**Description:** Identify and trace security enforcement points (authz/authn, input validation, origin/CSRF checks, path/URI gating, logging redaction) using references and definitions (keywords: auth, validate, sanitize, redact, token, secret, permission).

**Inputs:** a few “guard keywords” plus optional entrypoint symbol(s)

**Procedure:**

1. Find likely guard symbols via `workspaceSymbols` (auth/validate/sanitize/redact).
2. For each guard, `references` (paged) to see where it is enforced.
3. Follow key call chains with `definition` to confirm _what_ is enforced (not just name-based inference).
4. Summarize as “Guard surface map”:
   - Guard symbol → enforced at → protects what input/output → potential bypass (callers that skip it)

**Output:** deterministic “guard map” table with evidence locations.

Why it’s worth shipping: security review checklists are universal, and LSP traces are faster than manual grep.

---

### 3) `lsp_audit_determinism-and-paging`

**Concrete application:** “Does this repo’s pagination/cursor logic produce stable results?” Works for APIs, CLIs, listing commands, search endpoints, SDK iterators.

**Description:** Audit determinism for paged or list-returning APIs: stable sort keys, dedupe keys, cursor/page token semantics, and hard caps (keywords: cursor, page, limit, offset, token, sort, stable, deterministic).

**Inputs:** names of list/search functions or endpoints (or the word “cursor/page/limit”)

**Procedure:**

1. `workspaceSymbols` for “cursor/page/limit/sort” and likely list APIs.
2. For each candidate list API:
   - `definition` to locate implementation
   - `references` to find all call sites and variants

3. Confirm sorting/dedupe and cursor encode/decode paths (using `definition` chaining).
4. Output “Paging contract summary” per API:
   - Inputs accepted
   - Sort key(s)
   - Cursor/token composition
   - Caps/limits behavior
   - Error behavior on invalid cursor

**Output:** per-API structured summary with symbol locations.

Why it’s worth shipping: paging bugs are high-impact and common across ecosystems.

---

### 4) `lsp_audit_schema-runtime-consistency`

**Concrete application:** “Do schemas/docs/tests match what runtime actually accepts/returns?” Works for JSON-RPC, REST OpenAPI, config schemas, CLI flag schemas, protobuf/IDL, etc.

**Description:** Cross-check schema definitions against runtime validation/serialization code and tests using symbol tracing (keywords: schema, validate, parse, serialize, request, response, contract).

**Inputs:** schema entry name(s) or schema-related keywords; optional “tool/method/endpoint name”

**Procedure:**

1. Locate schema definitions (often JSON/TS types). Use `workspaceSymbols` for “schema/validate/ajv/zod/joi/openapi”.
2. Trace from schema → validator usage sites via `references`.
3. Trace runtime handlers/serializers back to schema types via `references` and `definition`.
4. Identify drift:
   - fields present in runtime but absent in schema (or vice versa)
   - tests missing for required fields / error mapping

**Output:** “drift findings” list with `(field/symbol, expected, observed, evidence)`.

Why it’s worth shipping: most repos that evolve quickly accumulate schema/runtime mismatch.

---

### 5) `lsp_triage_error-to-root-cause`

**Concrete application:** “Given an error message or diagnostic, find the throwing site, the callers, and the likely root cause.” Works for runtime exceptions, log strings, and type errors.

**Description:** Triage an error/diagnostic by locating its origin, tracing callers, and identifying the failing contract/type boundary (keywords: error, exception, fails, stack, diagnostic, TypeScript error, compile error).

**Inputs:** error text or diagnostic snippet; optional file and line.

**Procedure:**

1. If file/line is provided: start there; otherwise use `workspaceSymbols` with error-string keywords.
2. `definition` at the failing usage site; then `references` to find how it’s called.
3. Use `hover` to capture expected vs actual type/params at the boundary.
4. Output:
   - origin site(s)
   - top call chain slice (bounded)
   - “likely fix vectors” (e.g., wrong type passed, missing null check, wrong overload)

**Output:** short, structured incident note with evidence locations.

Why it’s worth shipping: this is the single most common “real-world” use of language intelligence.

---

### 6) `lsp_map_feature-surface`

**Concrete application:** “Give me the map of this subsystem: public entrypoints, key types, and where they’re used.” Works for onboarding, reviews, and refactors.

**Description:** Build a bounded feature map for a subsystem: key symbols, their definitions, and reference hotspots (keywords: overview, map, architecture, entrypoint, module, subsystem).

**Inputs:** a query string (module/feature name) + optional file/folder focus.

**Procedure:**

1. `workspaceSymbols` for the feature query; take top N symbols.
2. For each, pull `definition`, then `references` count (paged but bounded).
3. Rank symbols by “reference density” as a proxy for importance.
4. Output:
   - top entrypoints
   - core types/interfaces
   - hotspot files

**Output:** deterministic “feature map” list and hotspot summary.

Why it’s worth shipping: it’s the fastest way to understand unfamiliar code without bespoke repo knowledge.

---

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
