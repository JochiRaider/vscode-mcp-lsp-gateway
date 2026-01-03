---
name: lsp-map-feature-surface
description: Build a bounded feature map for a subsystem by querying LSP workspace symbols, resolving definitions, and counting references to rank entrypoints, core types, and hotspot files. Use when asked to map a module/feature/subsystem, identify public entrypoints, or find usage hotspots for onboarding, reviews, or refactors.
---

# Lsp Map Feature Surface

## Overview

Create a deterministic feature map for a named subsystem by using LSP symbol search, definition lookup, and bounded reference counts to rank importance and highlight hotspots.

## Workflow

### 1. Collect candidate symbols

- Input: query string (feature/module name) and optional file/folder focus.
- Call `workspaceSymbols` with the query.
- Canonicalize and stable-sort symbols by: `name`, `kind`, `uri`, `line`, `character`.
- Take the top N (default 30; cap at 50).
- If focus is provided, prefer symbols whose `uri` is under that focus; drop others only if you still have >= 10 candidates.

### 2. Resolve definitions and references

For each candidate symbol (in the sorted order):

- Call `definition` to locate the definitive symbol location. If multiple results, prefer the first within focus; otherwise take the first stable-sorted by `uri`, `line`, `character`.
- Call `references` to count uses. Page through results with a hard cap (default 200 total references per symbol). Record `refCount` and `refCapped`.
- If definition is missing or out of bounds, skip the symbol.

### 3. Rank and summarize

- Rank symbols by `refCount` desc, then by `name`, `kind`, `uri`, `line`, `character`.
- Classify:
  - Entrypoints: functions, methods, modules, or exported values with the highest `refCount`.
  - Core types/interfaces: `class`, `interface`, `type`, `enum`, or similar kinds.
- Build hotspot files by aggregating reference counts per `uri`, then sort by total refs desc, then `uri`.

## Output format

Produce a concise, deterministic map:

- Top entrypoints (name, kind, definition location, refCount, refCapped)
- Core types/interfaces (same fields)
- Hotspot files (uri, totalRefCount, top 3 symbols contributing)
- Note any caps or skipped symbols due to missing definitions or out-of-focus locations.

## Notes

- Keep all lists stable-sorted for determinism.
- Bound all paging and do not fetch unbounded references.
- Prefer minimal text summaries; the structured list is the primary output.
