import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  computeRequestKey,
  computeSnapshotKey,
  decodeCursor,
  encodeCursor,
  formatEpochTupleString,
  paginate,
  validateCursor,
} from '../../src/tools/paging/cursor.js';
import { checkReferencesTotalCap, handleReferences } from '../../src/tools/handlers/references.js';
import {
  checkWorkspaceSymbolsTotalCap,
  normalizeWorkspaceSymbolsQuery,
} from '../../src/tools/handlers/workspaceSymbols.js';
import { canonicalizeAndGateFileUri } from '../../src/workspace/uri.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

describe('cursor helpers', () => {
  it('encodes/decodes a v2 cursor payload', () => {
    const key = computeRequestKey('vscode_lsp_workspaceSymbols', ['query']);
    const snapshotKey = computeSnapshotKey(key, 'fp');
    const encoded = encodeCursor({ v: 2, o: 5, k: key, s: snapshotKey });
    const decoded = decodeCursor(encoded);
    expect(decoded).to.deep.equal({ v: 2, o: 5, k: key, s: snapshotKey });
  });

  it('derives request keys from structured inputs without delimiter collisions', () => {
    const key1 = computeRequestKey('vscode_lsp_workspaceSymbols', ['a|b', 'c']);
    const key2 = computeRequestKey('vscode_lsp_workspaceSymbols', ['a', 'b|c']);
    expect(key1).to.not.equal(key2);

    const key3 = computeRequestKey('vscode_lsp_workspaceSymbols', ['1', 2]);
    const key4 = computeRequestKey('vscode_lsp_workspaceSymbols', [1, '2']);
    expect(key3).to.not.equal(key4);
  });

  it('derives snapshot keys from a stable epoch tuple string', () => {
    const requestKey = 'request-key';
    const epochTupleString = formatEpochTupleString('roots-key', [3, 7, 11]);
    expect(epochTupleString).to.equal('roots:roots-key|epochs:3,7,11');
    const expected = createHash('sha256')
      .update(`v1|snapshot|${requestKey}|${epochTupleString}`, 'utf8')
      .digest('hex');
    expect(computeSnapshotKey(requestKey, epochTupleString)).to.equal(expected);
  });

  it('rejects invalid cursor payloads deterministically', () => {
    const key = computeRequestKey('vscode_lsp_workspaceSymbols', ['query']);
    const snapshotKey = computeSnapshotKey(key, 'fp');
    const encoded = encodeCursor({ v: 2, o: 0, k: key, s: snapshotKey });

    const assertInvalid = (cursor: unknown) => {
      const res = validateCursor(cursor as string, key, snapshotKey);
      expect(res.ok).to.equal(false);
      if (!res.ok) {
        const data = res.error.data as { code?: string };
        expect(res.error.code).to.equal(-32602);
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
      }
    };

    const badVersion = Buffer.from(
      JSON.stringify({ v: 1, o: 0, k: key, s: snapshotKey }),
      'utf8',
    ).toString('base64url');
    assertInvalid(badVersion);

    const badOffset = Buffer.from(
      JSON.stringify({ v: 2, o: -1, k: key, s: snapshotKey }),
      'utf8',
    ).toString('base64url');
    assertInvalid(badOffset);

    const mismatchRes = validateCursor(encoded, `${key}x`, snapshotKey);
    expect(mismatchRes.ok).to.equal(false);
    if (!mismatchRes.ok) {
      const data = mismatchRes.error.data as { code?: string };
      expect(mismatchRes.error.code).to.equal(-32602);
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }

    const missingKey = Buffer.from(JSON.stringify({ v: 2, o: 0, s: snapshotKey }), 'utf8').toString(
      'base64url',
    );
    assertInvalid(missingKey);

    const nonIntegerOffset = Buffer.from(
      JSON.stringify({ v: 2, o: 1.5, k: key, s: snapshotKey }),
      'utf8',
    ).toString('base64url');
    assertInvalid(nonIntegerOffset);

    const invalidJson = Buffer.from('{not-json', 'utf8').toString('base64url');
    assertInvalid(invalidJson);

    assertInvalid('%%%');
    assertInvalid('');
    assertInvalid(123);
  });

  it('rejects snapshot mismatches deterministically', () => {
    const key = computeRequestKey('vscode_lsp_workspaceSymbols', ['query']);
    const snapshotKey = computeSnapshotKey(key, 'fp');
    const staleSnapshotKey = computeSnapshotKey(key, 'fp-next');
    const encoded = encodeCursor({ v: 2, o: 0, k: key, s: staleSnapshotKey });

    const res = validateCursor(encoded, key, snapshotKey);
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      const data = res.error.data as { code?: string };
      expect(res.error.code).to.equal(-32602);
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_STALE');
    }
  });

  it('paginates deterministically with stable cursors', () => {
    const key = computeRequestKey('vscode_lsp_workspaceSymbols', ['query']);
    const snapshotKey = computeSnapshotKey(key, 'fp');
    const full = [1, 2, 3, 4, 5];

    const first = paginate(full, 2, null, key, snapshotKey);
    expect(first.ok).to.equal(true);
    if (!first.ok) return;
    expect(first.items).to.deep.equal([1, 2]);
    expect(first.nextCursor).to.be.a('string');

    const second = paginate(full, 2, first.nextCursor, key, snapshotKey);
    expect(second.ok).to.equal(true);
    if (!second.ok) return;
    expect(second.items).to.deep.equal([3, 4]);
    expect(second.nextCursor).to.be.a('string');

    const third = paginate(full, 2, second.nextCursor, key, snapshotKey);
    expect(third.ok).to.equal(true);
    if (!third.ok) return;
    expect(third.items).to.deep.equal([5]);
    expect(third.nextCursor).to.equal(null);
  });
});

describe('paged tool cursor validation', () => {
  it('rejects cursor mismatches for references', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const filePath = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const fileUri = vscode.Uri.file(filePath).toString();
    const gated = await canonicalizeAndGateFileUri(fileUri, allowedRootsRealpaths);
    expect(gated.ok).to.equal(true);
    if (!gated.ok) return;

    const toolRuntime = new ToolRuntime();
    const requestKey = computeRequestKey('vscode_lsp_references', [gated.value.uri, 1, 2, false]);
    const epochTupleString = toolRuntime.getSnapshotFingerprint(
      'vscode_lsp_references',
      allowedRootsRealpaths,
    );
    const snapshotKey = computeSnapshotKey(requestKey, epochTupleString);
    const cursor = encodeCursor({ v: 2, o: 0, k: requestKey, s: snapshotKey });

    const res = await handleReferences(
      {
        uri: fileUri,
        position: { line: 1, character: 2 },
        includeDeclaration: true,
        cursor,
      },
      { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
    );

    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });

  it('returns CAP_EXCEEDED for references total-set cap', () => {
    const err = checkReferencesTotalCap(20001);
    expect(err).to.not.equal(undefined);
    if (!err) return;
    expect(err.code).to.equal(-32603);
    const data = err.data as { code?: string };
    expect(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });

  it('normalizes workspace symbol queries via trim', () => {
    expect(normalizeWorkspaceSymbolsQuery('  foo  ')).to.equal('foo');
  });

  it('rejects cursor mismatches for workspace symbols', () => {
    const k1 = computeRequestKey('vscode_lsp_workspaceSymbols', [
      normalizeWorkspaceSymbolsQuery('  foo  '),
    ]);
    const snapshotKey = computeSnapshotKey(k1, 'fp');
    const cursor = encodeCursor({ v: 2, o: 0, k: k1, s: snapshotKey });
    const k2 = computeRequestKey('vscode_lsp_workspaceSymbols', ['bar']);
    const snapshotKey2 = computeSnapshotKey(k2, 'fp');
    const res = validateCursor(cursor, k2, snapshotKey2);
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });

  it('returns CAP_EXCEEDED for workspace symbols total-set cap', () => {
    const err = checkWorkspaceSymbolsTotalCap(20001);
    expect(err).to.not.equal(undefined);
    if (!err) return;
    expect(err.code).to.equal(-32603);
    const data = err.data as { code?: string };
    expect(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
});
