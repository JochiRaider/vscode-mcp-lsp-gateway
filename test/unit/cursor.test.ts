import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  computeRequestKey,
  decodeCursor,
  encodeCursor,
  paginate,
  validateCursor,
} from '../../src/tools/paging/cursor';
import { handleReferences } from '../../src/tools/handlers/references';
import { SchemaRegistry } from '../../src/tools/schemaRegistry';
import { canonicalizeAndGateFileUri } from '../../src/workspace/uri';

function createTestContext(repoRoot: string): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file(repoRoot),
    asAbsolutePath: (relPath: string) => path.join(repoRoot, relPath),
  } as unknown as vscode.ExtensionContext;
}

describe('cursor helpers', () => {
  it('encodes/decodes a v1 cursor payload', () => {
    const key = computeRequestKey('vscode.lsp.workspaceSymbols', ['query']);
    const encoded = encodeCursor({ v: 1, o: 5, k: key });
    const decoded = decodeCursor(encoded);
    expect(decoded).to.deep.equal({ v: 1, o: 5, k: key });
  });

  it('rejects invalid cursor payloads deterministically', () => {
    const key = computeRequestKey('vscode.lsp.workspaceSymbols', ['query']);
    const encoded = encodeCursor({ v: 1, o: 0, k: key });

    const badVersion = Buffer.from(
      JSON.stringify({ v: 2, o: 0, k: key }),
      'utf8',
    ).toString('base64url');
    const versionRes = validateCursor(badVersion, key);
    expect(versionRes.ok).to.equal(false);
    if (!versionRes.ok) {
      const data = versionRes.error.data as { code?: string };
      expect(versionRes.error.code).to.equal(-32602);
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }

    const badOffset = Buffer.from(
      JSON.stringify({ v: 1, o: -1, k: key }),
      'utf8',
    ).toString('base64url');
    const offsetRes = validateCursor(badOffset, key);
    expect(offsetRes.ok).to.equal(false);
    if (!offsetRes.ok) {
      const data = offsetRes.error.data as { code?: string };
      expect(offsetRes.error.code).to.equal(-32602);
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }

    const mismatchRes = validateCursor(encoded, `${key}x`);
    expect(mismatchRes.ok).to.equal(false);
    if (!mismatchRes.ok) {
      const data = mismatchRes.error.data as { code?: string };
      expect(mismatchRes.error.code).to.equal(-32602);
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });

  it('paginates deterministically with stable cursors', () => {
    const key = computeRequestKey('vscode.lsp.workspaceSymbols', ['query']);
    const full = [1, 2, 3, 4, 5];

    const first = paginate(full, 2, null, key);
    expect(first.ok).to.equal(true);
    if (!first.ok) return;
    expect(first.items).to.deep.equal([1, 2]);
    expect(first.nextCursor).to.be.a('string');

    const second = paginate(full, 2, first.nextCursor, key);
    expect(second.ok).to.equal(true);
    if (!second.ok) return;
    expect(second.items).to.deep.equal([3, 4]);
    expect(second.nextCursor).to.be.a('string');

    const third = paginate(full, 2, second.nextCursor, key);
    expect(third.ok).to.equal(true);
    if (!third.ok) return;
    expect(third.items).to.deep.equal([5]);
    expect(third.nextCursor).to.equal(null);
  });
});

describe('paged tool cursor validation', () => {
  it('rejects cursor mismatches for references', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const filePath = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const fileUri = vscode.Uri.file(filePath).toString();
    const gated = await canonicalizeAndGateFileUri(fileUri, allowedRootsRealpaths);
    expect(gated.ok).to.equal(true);
    if (!gated.ok) return;

    const requestKey = computeRequestKey('vscode.lsp.references', [
      gated.value.uri,
      1,
      2,
      false,
    ]);
    const cursor = encodeCursor({ v: 1, o: 0, k: requestKey });

    const res = await handleReferences(
      {
        uri: fileUri,
        position: { line: 1, character: 2 },
        includeDeclaration: true,
        cursor,
      },
      { schemaRegistry, allowedRootsRealpaths },
    );

    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
});
