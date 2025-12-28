// src/workspace/roots.ts
//
// Computes the allowlisted filesystem roots for workspace/URI gating.
//
// v1 rules (summary):
// - Allowed roots = open VS Code workspace folders (file: only) + configured additional roots.
// - Roots are canonicalized to realpaths (symlinks resolved).
// - Results are deterministic: stable sorted + deduped.
// - Fail-closed: invalid/non-existent/non-absolute additional roots are ignored.

import * as path from "node:path";
import * as vscode from "vscode";
import * as fsp from "node:fs/promises";

export type AllowedRoots = Readonly<{
  /** Canonical realpaths (symlinks resolved), stable-sorted, deduped. */
  roots: readonly string[];
  /** Convenience set for membership checks. */
  rootsSet: ReadonlySet<string>;
}>;

export async function computeAllowedRoots(
  additionalAllowedRoots: readonly string[],
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = vscode.workspace.workspaceFolders,
): Promise<AllowedRoots> {
  const candidates: string[] = [];

  // Workspace folders (file: only).
  for (const wf of workspaceFolders ?? []) {
    if (wf.uri.scheme !== "file") continue;
    const fsPath = wf.uri.fsPath;
    if (typeof fsPath === "string" && fsPath.trim().length > 0) candidates.push(fsPath);
  }

  // Additional allowed roots (absolute filesystem paths only).
  for (const raw of additionalAllowedRoots ?? []) {
    if (typeof raw === "string" && raw.trim().length > 0) candidates.push(raw);
  }

  const dedup = new Map<string, true>();

  for (const raw of candidates) {
    const normalized = normalizeCandidatePath(raw);
    if (!normalized) continue;

    const rp = await tryRealpath(normalized);
    if (!rp) continue;

    const canon = stripTrailingSeparators(path.normalize(rp));
    dedup.set(canon, true);
  }

  const roots = Array.from(dedup.keys()).sort(compareStringsAsc);
  return { roots, rootsSet: new Set(roots) };
}

async function tryRealpath(p: string): Promise<string | undefined> {
  try {
    // realpath resolves symlinks and normalizes the on-disk path.
    return await fsp.realpath(p);
  } catch {
    return undefined;
  }
}

function normalizeCandidatePath(raw: string): string | undefined {
  let s = raw.trim();
  if (s.length === 0) return undefined;

  // Strip surrounding quotes (common when pasting paths).
  s = stripSurroundingQuotes(s).trim();
  if (s.length === 0) return undefined;

  // Must be an absolute filesystem path (v1 config contract).
  if (!path.isAbsolute(s)) return undefined;

  // Normalize .. segments, separators, etc.
  const resolved = path.resolve(s);
  return stripTrailingSeparators(path.normalize(resolved));
}

function stripSurroundingQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function stripTrailingSeparators(p: string): string {
  const root = path.parse(p).root;
  if (p === root) return p;

  let out = p;
  while (out.length > root.length && (out.endsWith(path.sep) || out.endsWith("/") || out.endsWith("\\"))) {
    out = out.slice(0, -1);
  }
  return out.length === 0 ? root : out;
}

function compareStringsAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
