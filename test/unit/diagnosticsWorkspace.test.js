'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chai_1 = require('chai');
const vscode = require('vscode');
const diagnosticsWorkspace_1 = require('../../src/tools/handlers/diagnosticsWorkspace');
const diagnosticsDocument_1 = require('../../src/tools/handlers/diagnosticsDocument');
const cursor_1 = require('../../src/tools/paging/cursor');
describe('diagnostics workspace normalization', () => {
  it('filters out-of-root groups and sorts by canonical uri', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const fileA = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const fileB = path.join(repoRoot, 'docs', 'SECURITY.md');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lsp-gateway-'));
    const tempFile = path.join(tempDir, 'out.ts');
    fs.writeFileSync(tempFile, 'export const x = 1;', 'utf8');
    const diag = new vscode.Diagnostic(
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      'msg',
      vscode.DiagnosticSeverity.Warning,
    );
    const raw = [
      [vscode.Uri.file(fileB), [diag]],
      [vscode.Uri.file(tempFile), [diag]],
      [vscode.Uri.file(fileA), [diag]],
    ];
    const normalized = await (0, diagnosticsWorkspace_1.normalizeWorkspaceDiagnosticsGroups)(
      raw,
      allowedRootsRealpaths,
    );
    const uris = normalized.groups.map((g) => g.uri);
    const expected = [vscode.Uri.file(fileA).toString(), vscode.Uri.file(fileB).toString()].sort();
    (0, chai_1.expect)(uris).to.deep.equal(expected);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  it('enforces per-file MAX_ITEMS_NONPAGED deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const fileA = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const diagnostics = Array.from(
      { length: diagnosticsDocument_1.MAX_ITEMS_NONPAGED + 1 },
      (_, i) => {
        return new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, 1)),
          `m${i}`,
          vscode.DiagnosticSeverity.Error,
        );
      },
    );
    const raw = [[vscode.Uri.file(fileA), diagnostics]];
    const normalized = await (0, diagnosticsWorkspace_1.normalizeWorkspaceDiagnosticsGroups)(
      raw,
      allowedRootsRealpaths,
    );
    (0, chai_1.expect)(normalized.groups.length).to.equal(1);
    (0, chai_1.expect)(normalized.groups[0].diagnostics.length).to.equal(
      diagnosticsDocument_1.MAX_ITEMS_NONPAGED,
    );
    (0, chai_1.expect)(normalized.groups[0].capped).to.equal(true);
  });
});
describe('diagnostics workspace paging', () => {
  it('pages by file groups, not by diagnostics', () => {
    const groups = [
      {
        uri: 'file:///a.ts',
        diagnostics: [
          {
            id: 'sha256:1',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: 'a',
          },
        ],
        capped: false,
      },
      {
        uri: 'file:///b.ts',
        diagnostics: [
          {
            id: 'sha256:2',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: 'b',
          },
        ],
        capped: false,
      },
    ];
    const requestKey = (0, cursor_1.computeRequestKey)('vscode.lsp.diagnostics.workspace', []);
    const paged = (0, cursor_1.paginate)(groups, 1, null, requestKey);
    (0, chai_1.expect)(paged.ok).to.equal(true);
    if (!paged.ok) return;
    (0, chai_1.expect)(paged.items.length).to.equal(1);
    (0, chai_1.expect)(paged.items[0].uri).to.equal('file:///a.ts');
  });
  it('rejects cursor mismatches deterministically', () => {
    const requestKey = (0, cursor_1.computeRequestKey)('vscode.lsp.diagnostics.workspace', []);
    const otherKey = (0, cursor_1.computeRequestKey)('vscode.lsp.diagnostics.workspace', ['x']);
    const cursor = (0, cursor_1.encodeCursor)({ v: 1, o: 0, k: otherKey });
    const paged = (0, cursor_1.paginate)([], 1, cursor, requestKey);
    (0, chai_1.expect)(paged.ok).to.equal(false);
    if (!paged.ok) {
      (0, chai_1.expect)(paged.error.code).to.equal(-32602);
      const data = paged.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
});
describe('diagnostics workspace caps', () => {
  it('returns CAP_EXCEEDED when total file count exceeds max', () => {
    const err = (0, diagnosticsWorkspace_1.checkWorkspaceDiagnosticsTotalCap)(5001);
    (0, chai_1.expect)(err).to.not.equal(undefined);
    if (!err) return;
    (0, chai_1.expect)(err.code).to.equal(-32603);
    const data = err.data;
    (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
});
//# sourceMappingURL=diagnosticsWorkspace.test.js.map
