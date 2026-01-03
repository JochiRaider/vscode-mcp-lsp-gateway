# CODEX_SKILLs.md

Best practices for authoring Codex Agent Skills (`SKILL.md`) that work well in both **Codex IDE** and **Codex CLI**.

This guide assumes skills live under:
This guide assumes skills live under Codex-supported locations and precedence.

Codex loads skills (highest precedence first) from:

- Repo scope (CWD): `$CWD/.codex/skills/<skill-name>/SKILL.md`
- Repo scope (parent of CWD): `$CWD/../.codex/skills/<skill-name>/SKILL.md` (when launched inside a Git repo)
- Repo scope (repo root): `$REPO_ROOT/.codex/skills/<skill-name>/SKILL.md` (when launched inside a Git repo)
- User scope: `$CODEX_HOME/skills/<skill-name>/SKILL.md` (macOS/Linux default: `~/.codex/skills`)
- Admin scope: `/etc/codex/skills/<skill-name>/SKILL.md`
- System scope: bundled with Codex (built-ins)

When the same skill `name` exists in multiple scopes, Codex overwrites lower-precedence versions with higher-precedence ones.

A skill is one folder with a required `SKILL.md` plus optional `scripts/`, `references/`, and `assets/`.

---

## 1) Mental model: how Codex uses skills

### Progressive disclosure (optimize for context economics)

- On startup, Codex uses skill metadata (especially `name` and `description`) to decide what is available.
- When a skill is invoked (explicitly by `$skill-name` or implicitly by routing), Codex reads the skill body and any referenced files as needed.

Implications:

- Codex injects only the skill’s `name`, `description`, and file path into runtime context by default. The body is not injected unless explicitly invoked.
- The `description` is both discovery and routing.
- Keep `SKILL.md` as a concise execution playbook; move deep detail into `references/` and templates into `assets/`.

---

## 2) Skill locations, scope, and precedence

Codex loads skills from multiple scopes and may override same-name skills from lower precedence.

Recommended scope strategy:

1. 1. Repo scope: canonical for team workflows and repository contracts. Prefer repo-root skills for org-wide repo behavior; use CWD / parent scopes for module- or service-specific skills.
2. User scope: personal workflows and experiments.
3. Admin/system scope: managed defaults. Keep minimal.

Best practices:

- Prefer repo scope for shared, enforceable behavior (quality gates, release procedures, compliance workflows).
- Namespace skill names to avoid collisions (example: `mcp-lsp-quality-gates`, not `quality-gates`).
- Treat skill updates like code: PR review, ownership, and changelog discipline.
- Codex ignores symlinked skill directories; avoid symlinks for skills.

---

## 3) Naming and YAML frontmatter rules (portable baseline)

To maximize portability, follow the stricter constraints commonly used across tools.
Codex enforces specific validation rules for required fields. For portability across ecosystems, keep names conventional (lowercase + hyphens), but treat the constraints below as the “must-pass” Codex baseline unless you have a known target runtime with different rules.

### Folder name and skill name

- One folder per skill.
- Folder name should match `name`.
- Prefer lowercase with hyphens.

### Required YAML fields

- `name`:
  - non-empty
  - **single line**
  - **at most 100 characters**
  - lowercase letters, digits, hyphen
  - no leading or trailing hyphen
  - no consecutive `--`
- `description`:
  - non-empty
  - **single line**
  - **at most 500 characters**
  - must be specific enough to act as routing logic

Notes:

- Codex ignores extra YAML keys it doesn’t recognize; do not rely on unknown keys being enforced.

### Optional YAML fields (recommended)

- `metadata`: ownership and maintenance metadata.
- `compatibility`: environment assumptions (OS, tools, network, permissions).
- `license`: if sharing outside your org.
- `allowed-tools`: experimental; do not assume support.

Recommended YAML pattern:

```yaml
---
name: example-skill
description: Runs the repo quality gates and summarizes failures with actionable fixes. Use when CI fails, before PRs, or after refactors (keywords: lint, typecheck, unit tests, CI).
compatibility: Works in Codex CLI and Codex IDE. No network required.
metadata:
  owner: platform-eng
  version: "1.0"
  maturity: stable
  short-description: Run repo quality gates
license: Proprietary
---
```

---

## 4) Writing a high-signal description (discovery plus routing)

The `description` is the primary routing surface. Codex evaluates all descriptions simultaneously, so clarity and specificity reduce routing confusion.

### Description checklist

Include:

- Capability: what the skill does, in concrete terms.
- Trigger conditions: when to use it, including common keywords users will type.
- Boundaries: what it does not do (optional but useful when skills overlap).
- Outputs: what artifacts or results the user will get.

Good example:

> “Prepares a VSIX release by validating package metadata, bundling runtime dependencies, and generating a release checklist artifact. Use for VS Code extension packaging, CI release jobs, or marketplace publishing (keywords: vsix, vsce, esbuild, bundle, publish).”

Weak example:

> “Helps with packaging.”

### Failure patterns (and how to fix them)

- Too broad: “Helps with testing.”
  - Fix: name the specific test types, commands, and outputs the skill produces.

- Overlaps with other skills: “Runs CI checks” overlaps with “Builds release artifact.”
  - Fix: narrow one description to pre-merge gates and the other to packaging or release workflows.

- Missing trigger keywords: the user asks about “lint” but the description never mentions linting.
  - Fix: add representative keywords users actually type.

### Testing your description (required before finalizing)

Before finalizing a skill:

1. Write **three example prompts that should trigger** the skill.
2. Write **three example prompts that should not trigger** it.
3. Test each one to verify routing behavior.

If similar prompts trigger different skills inconsistently, the descriptions likely overlap and need narrowing. The goal is not perfect determinism, it is predictable, intuitive routing under realistic prompts.

Example trigger prompts (should trigger):

- “CI is failing on lint and typecheck. What do I run locally?”
- “Before I open this PR, run the standard quality gates and summarize failures.”
- “Our pre-commit hooks are failing. Diagnose and propose fixes.”

Example non-trigger prompts (should not trigger):

- “Write unit tests for this function.”
- “Explain why this algorithm is O(n log n).”
- “Refactor this file for readability.”

---

## 5) SKILL.md body structure (make it executable)

A skill body should be a short, unambiguous SOP with verification steps.

### Recommended sections

1. Purpose
2. When to use
3. Inputs (required and optional)
4. Outputs (files, reports, summaries)
5. Prerequisites (tools, env vars, permissions)
6. Procedure (numbered steps with checkpoints)
7. Verification (commands plus expected signals)
8. Failure modes (common errors and next steps)
9. Examples (one minimal, one realistic)
10. Resources (links to `./references/...`, `./assets/...`, `./scripts/...`)

### Keep the body lean

- Treat `SKILL.md` as the execution playbook, not a full manual.
- Put long schemas, templates, deep examples, and background material into `references/` or `assets/`.

### Context window economics (practical rule)

Since only the `SKILL.md` body loads when invoked, aim to keep it under roughly **300 lines**. If you exceed this, you are likely combining multiple concerns. Consider:

- splitting into separate skills, or
- moving detailed examples and background into `references/`.

The body should read like an executive summary that can stand alone. References provide deep-dive detail only when needed.

---

## 6) Script-backed skills: the high bar for adding code

GPT-5.2-Codex is materially better at following complex instructions than earlier generations. Many workflows that previously needed scripts for determinism can now be handled through clear, testable instructions.

Codex-specific recommendation:

- Prefer instruction-only skills by default; use scripts when you need determinism, strict validation, or reliable artifact generation under hard constraints.

Before adding scripts, ask:

- Does this task genuinely require programmatic logic?
- Would better instruction writing suffice?

Scripts add maintenance burden, dependency management, and additional failure points. They are valuable when you need to:

- enforce strict formats,
- validate against schemas,
- integrate with external systems where API precision matters,
- generate structured artifacts reliably.

Scripts are usually unnecessary for:

- orchestrating routine commands the agent can run directly,
- simple transformations the model can perform reliably from instructions,
- tasks where the primary complexity is decision-making rather than computation.

### Script hygiene rules

- Prefer read-only and non-destructive defaults.
- Make scripts idempotent.
- Emit actionable errors and an unambiguous exit code.
- Document dependencies and versions in `Prerequisites`.
- Provide a fallback path if the script cannot run.

---

## 7) IDE versus CLI: authoring for both surfaces

Codex IDE and Codex CLI share the same skill mechanics, but their default context model differs.

### Codex IDE guidance

- The IDE often has richer ambient context: open files, recent edits, selected ranges.
- Skills can leverage “the file you just edited” or “the selected lines” safely, if they include a fallback when that context is missing.

Recommended phrasing:

- “If running in the IDE and a code range is selected, treat the selection as the authoritative scope.”
- “Open the primary file and its nearest caller before proceeding.”

### Codex CLI guidance

- The CLI is typically more stateless per invocation.
- Skills should explicitly gather missing context (paths, module roots, commands used).

Recommended phrasing:

- “If running in CLI, ask the user to provide relevant paths via `@path` or specify the module root.”
- “If the target file is unclear, ask for 1 to 3 candidate files rather than guessing.”

### Context persistence differences (add this mental model)

The IDE maintains awareness of project structure, open files, and recent changes across the session. The CLI starts each invocation more cleanly. When writing skills meant for both:

- include conditional phrasing like:
  - “If you do not have context about which files are relevant, ask the user to specify paths before proceeding.”
    This prevents assumptions that work in the IDE but fail in the CLI.

---

## 8) Safety, approvals, and prompt-injection hygiene

Treat skills like production code.

Best practices:

- Never embed secrets (tokens, keys, credentials).
- Avoid language that mandates destructive operations without asking.
- Add explicit “ask before” checkpoints for:
  - deleting files
  - large refactors
  - networked tooling
  - security-sensitive configuration changes

- Prefer bounded operations: narrow scope, clear file lists, explicit commands, explicit outputs.
- If distributing skills, require review (PR plus codeowner) for changes to skills and scripts.

### Audit and observability (recommended for enterprise use)

For skills that perform sensitive operations or implement compliance requirements:

- include explicit logging steps,
- have the skill create a summary artifact documenting:
  - what it did,
  - which files it touched,
  - what decisions it made,
  - what commands ran,
  - and verification results.

This provides an audit trail and makes skill behavior easier to understand over time.

---

## 9) Versioning and maintenance

In `metadata`, include:

- `owner`
- `version`
- `maturity` (draft, stable, deprecated)

Deprecation policy:

- When renaming a skill, keep the old name for a transition period and point users to the new one.

### Managing breaking changes

When you need to change a skill’s behavior in ways that might surprise users:

- increment the major version number,
- update the description to signal the change.
  For truly breaking changes, consider creating a new skill with a new name, then deprecate the old one over a transition period. This prevents surprises mid-workflow and gives teams time to adjust.

---

## 10) Quality checklist (use before merging a new skill)

Discovery:

- [ ] Description includes capability, triggers, representative keywords, and output expectations.
- [ ] Name and folder follow the naming rules (lowercase, hyphens, 1 to 64 chars).

Correctness:

- [ ] Procedure has a clear definition of done.
- [ ] Verification steps are concrete and runnable.
- [ ] Failure modes include at least the top 3 expected errors.

Cross-surface:

- [ ] Steps work in IDE and CLI, or explicitly branch by surface.
- [ ] Missing context is gathered explicitly in CLI workflows.

Safety:

- [ ] No secrets.
- [ ] Risky actions require explicit confirmation.
- [ ] Scripts are bounded, documented, and optional when possible.

Testing:

- [ ] Tested with at least three realistic prompts, including edge cases where the skill should and should not trigger.

---

## 11) Minimal template (copy/paste)

Create:

- Repo scope: `.codex/skills/<skill-name>/SKILL.md`
- User scope: `~/.codex/skills/<skill-name>/SKILL.md`

`SKILL.md`:

```markdown
---
name: <skill-name>
description: <what it does> Use when <triggers/keywords>. Produces <outputs>.
compatibility: Works in Codex CLI and Codex IDE. <constraints>.
metadata:
  owner: <team-or-handle>
  version: '0.1'
  maturity: draft
  short-description: <optional tooltip>
license: Proprietary
---

# <Human-friendly title>

## Purpose

<What outcomes this skill reliably produces.>

## When to use

- <Trigger 1>
- <Trigger 2>

## Inputs

Required:

- <paths, identifiers, repo state assumptions>
  Optional:
- <scopes, flags, filters>

## Outputs

- <files/reports/diffs/summaries and where they go>

## Prerequisites

System requirements:

- <tools and versions>
- <environment variables that must be set>
  Permissions required:
- <file access needs>
- <network access if applicable>

## Procedure

1. <Step 1>
2. <Step 2>
3. <Checkpoint: ask user before doing X>
4. <Step 4>

## Verification

Run:

- `<command>`
  Expected:
- <observable success criteria>

## Failure modes

- <symptom>: <likely cause> -> <next step>

## Examples

### Should trigger

- "<example prompt 1>"
- "<example prompt 2>"
- "<example prompt 3>"

### Should NOT trigger

- "<example prompt 1>"
- "<example prompt 2>"
- "<example prompt 3>"

## Resources

- Script: `./scripts/<...>`
- Template: `./assets/<...>`
- Reference: `./references/<...>`
```

---

## 12) Evolution and feedback loops (skills are living documents)

Treat skills as iteratively improved operational assets.

Recommended feedback loop:

- Track when users **explicitly invoke** a skill versus when it **auto-triggers**.
- Review prompts that should have triggered but did not. Update the description keywords and triggers.
- Review prompts that triggered incorrectly. Narrow the description and add boundaries.
- Collect real failure modes and add them to the skill body with concrete fixes.
- Promote recurring “tribal knowledge” into references or templates.
- Periodically prune or deprecate skills that are obsolete or redundant.

Operational best practice:

- Maintain a small set of stable, high-signal skills rather than a large catalog of overlapping ones.

---

## 13) Troubleshooting (Codex-specific quick checks)

If a skill does not appear in Codex:

- Ensure the file is named exactly `SKILL.md`.
- Ensure YAML frontmatter is well-formed and that `name`/`description` are present, single-line, and within length limits.
- Ensure the skill directory is not symlinked (Codex ignores symlinked directories).
- Restart Codex after adding/updating skills.

If a skill appears but does not trigger:

- Make triggers explicit in `description` and include representative keywords users will type.
- If multiple skills overlap, narrow descriptions to improve selection predictability.
