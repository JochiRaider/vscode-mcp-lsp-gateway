'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('node:fs');
const path = require('node:path');
const chai_1 = require('chai');
const vscode = require('vscode');
const cursor_1 = require('../../src/tools/paging/cursor');
const references_1 = require('../../src/tools/handlers/references');
const workspaceSymbols_1 = require('../../src/tools/handlers/workspaceSymbols');
const uri_1 = require('../../src/workspace/uri');
describe('cursor helpers', () => {
  it('encodes/decodes a v1 cursor payload', () => {
    const key = (0, cursor_1.computeRequestKey)('vscode.lsp.workspaceSymbols', ['query']);
    const encoded = (0, cursor_1.encodeCursor)({ v: 1, o: 5, k: key });
    const decoded = (0, cursor_1.decodeCursor)(encoded);
    (0, chai_1.expect)(decoded).to.deep.equal({ v: 1, o: 5, k: key });
  });
  it('rejects invalid cursor payloads deterministically', () => {
    const key = (0, cursor_1.computeRequestKey)('vscode.lsp.workspaceSymbols', ['query']);
    const encoded = (0, cursor_1.encodeCursor)({ v: 1, o: 0, k: key });
    const badVersion = Buffer.from(JSON.stringify({ v: 2, o: 0, k: key }), 'utf8').toString(
      'base64url',
    );
    const versionRes = (0, cursor_1.validateCursor)(badVersion, key);
    (0, chai_1.expect)(versionRes.ok).to.equal(false);
    if (!versionRes.ok) {
      const data = versionRes.error.data;
      (0, chai_1.expect)(versionRes.error.code).to.equal(-32602);
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
    const badOffset = Buffer.from(JSON.stringify({ v: 1, o: -1, k: key }), 'utf8').toString(
      'base64url',
    );
    const offsetRes = (0, cursor_1.validateCursor)(badOffset, key);
    (0, chai_1.expect)(offsetRes.ok).to.equal(false);
    if (!offsetRes.ok) {
      const data = offsetRes.error.data;
      (0, chai_1.expect)(offsetRes.error.code).to.equal(-32602);
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
    const mismatchRes = (0, cursor_1.validateCursor)(encoded, `${key}x`);
    (0, chai_1.expect)(mismatchRes.ok).to.equal(false);
    if (!mismatchRes.ok) {
      const data = mismatchRes.error.data;
      (0, chai_1.expect)(mismatchRes.error.code).to.equal(-32602);
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
  it('paginates deterministically with stable cursors', () => {
    const key = (0, cursor_1.computeRequestKey)('vscode.lsp.workspaceSymbols', ['query']);
    const full = [1, 2, 3, 4, 5];
    const first = (0, cursor_1.paginate)(full, 2, null, key);
    (0, chai_1.expect)(first.ok).to.equal(true);
    if (!first.ok) return;
    (0, chai_1.expect)(first.items).to.deep.equal([1, 2]);
    (0, chai_1.expect)(first.nextCursor).to.be.a('string');
    const second = (0, cursor_1.paginate)(full, 2, first.nextCursor, key);
    (0, chai_1.expect)(second.ok).to.equal(true);
    if (!second.ok) return;
    (0, chai_1.expect)(second.items).to.deep.equal([3, 4]);
    (0, chai_1.expect)(second.nextCursor).to.be.a('string');
    const third = (0, cursor_1.paginate)(full, 2, second.nextCursor, key);
    (0, chai_1.expect)(third.ok).to.equal(true);
    if (!third.ok) return;
    (0, chai_1.expect)(third.items).to.deep.equal([5]);
    (0, chai_1.expect)(third.nextCursor).to.equal(null);
  });
});
describe('paged tool cursor validation', () => {
  it('rejects cursor mismatches for references', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const filePath = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const fileUri = vscode.Uri.file(filePath).toString();
    const gated = await (0, uri_1.canonicalizeAndGateFileUri)(fileUri, allowedRootsRealpaths);
    (0, chai_1.expect)(gated.ok).to.equal(true);
    if (!gated.ok) return;
    const requestKey = (0, cursor_1.computeRequestKey)('vscode.lsp.references', [
      gated.value.uri,
      1,
      2,
      false,
    ]);
    const cursor = (0, cursor_1.encodeCursor)({ v: 1, o: 0, k: requestKey });
    const res = await (0, references_1.handleReferences)(
      {
        uri: fileUri,
        position: { line: 1, character: 2 },
        includeDeclaration: true,
        cursor,
      },
      { allowedRootsRealpaths, maxItemsPerPage: 200 },
    );
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
  it('returns CAP_EXCEEDED for references total-set cap', () => {
    const err = (0, references_1.checkReferencesTotalCap)(20001);
    (0, chai_1.expect)(err).to.not.equal(undefined);
    if (!err) return;
    (0, chai_1.expect)(err.code).to.equal(-32603);
    const data = err.data;
    (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
  it('normalizes workspace symbol queries via trim', () => {
    (0, chai_1.expect)((0, workspaceSymbols_1.normalizeWorkspaceSymbolsQuery)('  foo  ')).to.equal(
      'foo',
    );
  });
  it('rejects cursor mismatches for workspace symbols', () => {
    const k1 = (0, cursor_1.computeRequestKey)('vscode.lsp.workspaceSymbols', [
      (0, workspaceSymbols_1.normalizeWorkspaceSymbolsQuery)('  foo  '),
    ]);
    const cursor = (0, cursor_1.encodeCursor)({ v: 1, o: 0, k: k1 });
    const k2 = (0, cursor_1.computeRequestKey)('vscode.lsp.workspaceSymbols', ['bar']);
    const res = (0, cursor_1.validateCursor)(cursor, k2);
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
  it('returns CAP_EXCEEDED for workspace symbols total-set cap', () => {
    const err = (0, workspaceSymbols_1.checkWorkspaceSymbolsTotalCap)(20001);
    (0, chai_1.expect)(err).to.not.equal(undefined);
    if (!err) return;
    (0, chai_1.expect)(err.code).to.equal(-32603);
    const data = err.data;
    (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
});
//# sourceMappingURL=cursor.test.js.map
