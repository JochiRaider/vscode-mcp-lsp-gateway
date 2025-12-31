'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const chai_1 = require('chai');
const vscode = require('vscode');
const diagnosticsDocument_1 = require('../../src/tools/handlers/diagnosticsDocument');
const ids_1 = require('../../src/tools/ids');
describe('diagnostics document normalization', () => {
  it('stringifies code variants and omits absent code', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
    const diagString = new vscode.Diagnostic(range, 'msg1', vscode.DiagnosticSeverity.Warning);
    diagString.code = 'TS123';
    const diagNumber = new vscode.Diagnostic(range, 'msg2', vscode.DiagnosticSeverity.Error);
    diagNumber.code = 42;
    const diagObject = new vscode.Diagnostic(range, 'msg3', vscode.DiagnosticSeverity.Information);
    diagObject.code = { value: 7, target: vscode.Uri.parse('https://example.com') };
    const diagNone = new vscode.Diagnostic(range, 'msg4', vscode.DiagnosticSeverity.Hint);
    const diagEmpty = new vscode.Diagnostic(range, 'msg5', vscode.DiagnosticSeverity.Warning);
    diagEmpty.code = '';
    const normalized = (0, diagnosticsDocument_1.normalizeDiagnostics)(
      [diagString, diagNumber, diagObject, diagNone, diagEmpty],
      'file:///abs/path/to/file.ts',
    );
    const codes = normalized.map((d) => d.code ?? '');
    (0, chai_1.expect)(codes).to.include('TS123');
    (0, chai_1.expect)(codes).to.include('42');
    (0, chai_1.expect)(codes).to.include('7');
    (0, chai_1.expect)(normalized.find((d) => d.message === 'msg4')?.code).to.equal(undefined);
    (0, chai_1.expect)(normalized.find((d) => d.message === 'msg5')?.code).to.equal(undefined);
  });
  it('sorts deterministically and dedupes exact duplicates', () => {
    const rangeA = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 1));
    const rangeB = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
    const diag1 = new vscode.Diagnostic(rangeA, 'b', vscode.DiagnosticSeverity.Warning);
    diag1.code = 'B';
    diag1.source = 's';
    const diag2 = new vscode.Diagnostic(rangeB, 'a', vscode.DiagnosticSeverity.Error);
    diag2.code = 'A';
    diag2.source = 's';
    const diag3 = new vscode.Diagnostic(rangeB, 'a', vscode.DiagnosticSeverity.Error);
    diag3.code = 'A';
    diag3.source = 's';
    const normalized = (0, diagnosticsDocument_1.normalizeDiagnostics)(
      [diag1, diag2, diag3],
      'file:///abs/path/to/file.ts',
    );
    (0, chai_1.expect)(normalized.length).to.equal(2);
    (0, chai_1.expect)(normalized[0].message).to.equal('a');
    (0, chai_1.expect)(normalized[1].message).to.equal('b');
  });
  it('generates stable ids from the canonical string', () => {
    const range = new vscode.Range(new vscode.Position(2, 3), new vscode.Position(2, 8));
    const diag = new vscode.Diagnostic(range, 'hello', vscode.DiagnosticSeverity.Warning);
    diag.code = 'X';
    diag.source = 'ts';
    const normalized = (0, diagnosticsDocument_1.normalizeDiagnostics)(
      [diag],
      'file:///abs/path/to/file.ts',
    );
    (0, chai_1.expect)(normalized.length).to.equal(1);
    const canonical = (0, diagnosticsDocument_1.buildDiagnosticCanonicalString)(
      'file:///abs/path/to/file.ts',
      normalized[0].range,
      normalized[0].severity,
      normalized[0].code,
      normalized[0].source,
      normalized[0].message,
    );
    (0, chai_1.expect)(normalized[0].id).to.equal(
      (0, ids_1.stableIdFromCanonicalString)(canonical),
    );
  });
  it('enforces MAX_ITEMS_NONPAGED deterministically', () => {
    const items = Array.from({ length: diagnosticsDocument_1.MAX_ITEMS_NONPAGED + 1 }, (_, i) => ({
      id: `sha256:${i}`,
      range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
      message: `m${i}`,
    }));
    const enforced = (0, diagnosticsDocument_1.enforceDiagnosticsCap)(items);
    (0, chai_1.expect)(enforced.items.length).to.equal(diagnosticsDocument_1.MAX_ITEMS_NONPAGED);
    (0, chai_1.expect)(enforced.capped).to.equal(true);
  });
});
describe('diagnostics document gating', () => {
  it('rejects invalid file URIs deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const missingPath = path.join(repoRoot, 'does-not-exist.ts');
    const missingUri = vscode.Uri.file(missingPath).toString();
    const res = await (0, diagnosticsDocument_1.handleDiagnosticsDocument)(
      { uri: missingUri },
      { allowedRootsRealpaths },
    );
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/URI_INVALID');
    }
  });
  it('rejects out-of-root file URIs deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lsp-gateway-'));
    const tempFile = path.join(tempDir, 'diag.ts');
    fs.writeFileSync(tempFile, 'export const x = 1;', 'utf8');
    const tempUri = vscode.Uri.file(tempFile).toString();
    const res = await (0, diagnosticsDocument_1.handleDiagnosticsDocument)(
      { uri: tempUri },
      { allowedRootsRealpaths },
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
    (0, chai_1.expect)(res.ok).to.equal(false);
    if (!res.ok) {
      (0, chai_1.expect)(res.error.code).to.equal(-32602);
      const data = res.error.data;
      (0, chai_1.expect)(data.code).to.equal('MCP_LSP_GATEWAY/WORKSPACE_DENIED');
    }
  });
});
//# sourceMappingURL=diagnosticsDocument.test.js.map
