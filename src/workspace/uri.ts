// src/workspace/uri.ts
//
// Workspace/URI gating helpers (v1):
// - Accept only `file:` URIs.
// - Canonicalize by resolving the filesystem realpath (symlinks), normalizing separators,
//   stripping trailing separators, and re-encoding as a canonical `file:` URI.
// - Check candidate realpath is equal to, or a descendant of, one of the allowed root realpaths.
// - Fail closed with contract error codes:
//   - malformed/non-file/unresolvable -> MCP_LSP_GATEWAY/URI_INVALID
//   - out of root (or no roots)       -> MCP_LSP_GATEWAY/WORKSPACE_DENIED

import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import * as vscode from 'vscode';

export type WorkspaceGateErrorCode =
  | 'MCP_LSP_GATEWAY/URI_INVALID'
  | 'MCP_LSP_GATEWAY/WORKSPACE_DENIED';

export type CanonicalFileTarget = Readonly<{
  /** Canonical `file:` URI string (deterministic for unchanged filesystem). */
  uri: string;
  /** VS Code fsPath for the parsed URI (platform-specific separators). */
  fsPath: string;
  /** Canonical filesystem realpath (symlinks resolved, normalized, no trailing separators). */
  realPath: string;
}>;

export type GateResult =
  | Readonly<{ ok: true; value: CanonicalFileTarget }>
  | Readonly<{ ok: false; code: WorkspaceGateErrorCode }>;

/**
 * Canonicalize a `file:` URI string to a `CanonicalFileTarget`, without checking allowed roots.
 */
export async function canonicalizeFileUri(
  uriString: string,
): Promise<
  | Readonly<{ ok: true; value: CanonicalFileTarget }>
  | Readonly<{ ok: false; code: 'MCP_LSP_GATEWAY/URI_INVALID' }>
> {
  const parsed = tryParseUri(uriString);
  if (!parsed) return { ok: false, code: 'MCP_LSP_GATEWAY/URI_INVALID' };
  if (parsed.scheme !== 'file') return { ok: false, code: 'MCP_LSP_GATEWAY/URI_INVALID' };

  const fsPath = parsed.fsPath;
  if (!fsPath || !path.isAbsolute(fsPath))
    return { ok: false, code: 'MCP_LSP_GATEWAY/URI_INVALID' };

  const realPath = await tryRealpath(fsPath);
  if (!realPath) return { ok: false, code: 'MCP_LSP_GATEWAY/URI_INVALID' };

  const canonRealPath = canonicalizeFsPath(realPath);
  const canonUri = canonicalFileUriFromRealPath(canonRealPath);

  return { ok: true, value: { uri: canonUri, fsPath, realPath: canonRealPath } };
}

/**
 * Canonicalize a `file:` URI string and enforce it is within allowed roots (realpaths).
 */
export async function canonicalizeAndGateFileUri(
  uriString: string,
  allowedRootsRealpaths: readonly string[],
): Promise<GateResult> {
  if (!allowedRootsRealpaths || allowedRootsRealpaths.length === 0) {
    return { ok: false, code: 'MCP_LSP_GATEWAY/WORKSPACE_DENIED' };
  }

  const canon = await canonicalizeFileUri(uriString);
  if (!canon.ok) return canon;

  if (!isRealPathAllowed(canon.value.realPath, allowedRootsRealpaths)) {
    return { ok: false, code: 'MCP_LSP_GATEWAY/WORKSPACE_DENIED' };
  }

  return canon;
}

/**
 * True iff `candidateRealPath` is equal to, or a descendant of, one of the allowed roots.
 *
 * Inputs are expected to already be canonical realpaths, but this function is defensive.
 */
export function isRealPathAllowed(
  candidateRealPath: string,
  allowedRootsRealpaths: readonly string[],
): boolean {
  const cand = canonicalizeFsPath(candidateRealPath);
  for (const rootRaw of allowedRootsRealpaths) {
    const root = canonicalizeFsPath(rootRaw);
    if (isEqualOrDescendant(root, cand)) return true;
  }
  return false;
}

/**
 * Convert a canonical filesystem realpath into a canonical `file:` URI string.
 */
export function canonicalFileUriFromRealPath(realPath: string): string {
  // vscode.Uri.file handles platform differences and produces a properly encoded file URI.
  return vscode.Uri.file(canonicalizeFsPath(realPath)).toString();
}

function tryParseUri(uriString: string): vscode.Uri | undefined {
  if (typeof uriString !== 'string') return undefined;
  const s = uriString.trim();
  if (s.length === 0) return undefined;
  try {
    return vscode.Uri.parse(s, true);
  } catch {
    return undefined;
  }
}

async function tryRealpath(fsPath: string): Promise<string | undefined> {
  try {
    return await fsp.realpath(fsPath);
  } catch {
    return undefined;
  }
}

function canonicalizeFsPath(p: string): string {
  const normalized = path.normalize(p);
  return stripTrailingSeparators(normalized);
}

function stripTrailingSeparators(p: string): string {
  const root = path.parse(p).root;
  if (p === root) return p;

  let out = p;
  while (
    out.length > root.length &&
    (out.endsWith(path.sep) || out.endsWith('/') || out.endsWith('\\'))
  ) {
    out = out.slice(0, -1);
  }
  return out.length === 0 ? root : out;
}

function isEqualOrDescendant(root: string, candidate: string): boolean {
  const rootKey = compareKey(root);
  const candKey = compareKey(candidate);
  if (candKey === rootKey) return true;

  // Use `relative` to avoid prefix-tricks and respect path boundaries.
  const rel = path.relative(root, candidate);

  // If different drive on Windows, rel is absolute (or includes a drive); reject.
  if (!rel || rel.length === 0) return true;
  if (path.isAbsolute(rel)) return false;

  // `..` (or `../...`) escapes the root; reject.
  // Also reject traversal segments that start with `..` as a full segment.
  const relNorm = rel.replace(/[\\/]+/g, path.sep);
  if (relNorm === '..' || relNorm.startsWith(`..${path.sep}`)) return false;

  return true;
}

function compareKey(p: string): string {
  // Windows is case-insensitive for path comparisons in most environments.
  // Do NOT mutate returned paths; this is only for equality/descendant checks.
  return process.platform === 'win32' ? p.toLowerCase() : p;
}
