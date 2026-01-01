import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  buildDiagnosticCanonicalString,
  enforceDiagnosticsCap,
  MAX_ITEMS_NONPAGED,
  normalizeDiagnostics,
  handleDiagnosticsDocument,
} from '../../src/tools/handlers/diagnosticsDocument.js';
import { stableIdFromCanonicalString } from '../../src/tools/ids.js';

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

    const normalized = normalizeDiagnostics(
      [diagString, diagNumber, diagObject, diagNone, diagEmpty],
      'file:///abs/path/to/file.ts',
    );

    const codes = normalized.map((d) => d.code ?? '');
    expect(codes).to.include('TS123');
    expect(codes).to.include('42');
    expect(codes).to.include('7');
    expect(normalized.find((d) => d.message === 'msg4')?.code).to.equal(undefined);
    expect(normalized.find((d) => d.message === 'msg5')?.code).to.equal(undefined);
  });

  it('accepts diagnostic-like objects and skips invalid entries', () => {
    const diagLike = {
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
      message: 'ok',
      severity: 2,
      code: 12,
      source: 'lint',
    };

    const invalidRange = {
      range: { start: { line: -1, character: 0 }, end: { line: 0, character: 1 } },
      message: 'bad',
    };

    const invalidMessage = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: '',
    };

    const normalized = normalizeDiagnostics(
      [diagLike, invalidRange, invalidMessage, 'nope'],
      'file:///abs/path/to/file.ts',
    );

    expect(normalized.length).to.equal(1);
    const first = normalized[0];
    if (!first) throw new Error('Expected a normalized diagnostic');
    expect(first.message).to.equal('ok');
    expect(first.code).to.equal('12');
    expect(first.source).to.equal('lint');
  });

  it('omits non-integer or negative severity values', () => {
    const range = {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };

    const normalized = normalizeDiagnostics(
      [
        { range, message: 'int', severity: 2 },
        { range, message: 'zero', severity: 0 },
        { range, message: 'float', severity: 1.5 },
        { range, message: 'neg', severity: -1 },
        { range, message: 'nan', severity: Number.NaN },
        { range, message: 'inf', severity: Number.POSITIVE_INFINITY },
      ],
      'file:///abs/path/to/file.ts',
    );

    const byMessage = (message: string) => normalized.find((d) => d.message === message);
    expect(byMessage('int')?.severity).to.equal(2);
    expect(byMessage('zero')?.severity).to.equal(0);
    expect(byMessage('float')?.severity).to.equal(undefined);
    expect(byMessage('neg')?.severity).to.equal(undefined);
    expect(byMessage('nan')?.severity).to.equal(undefined);
    expect(byMessage('inf')?.severity).to.equal(undefined);
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

    const normalized = normalizeDiagnostics([diag1, diag2, diag3], 'file:///abs/path/to/file.ts');

    expect(normalized.length).to.equal(2);
    const first = normalized[0];
    const second = normalized[1];
    if (!first || !second) throw new Error('Expected two normalized diagnostics');
    expect(first.message).to.equal('a');
    expect(second.message).to.equal('b');
  });

  it('generates stable ids from the canonical string', () => {
    const range = new vscode.Range(new vscode.Position(2, 3), new vscode.Position(2, 8));
    const diag = new vscode.Diagnostic(range, 'hello', vscode.DiagnosticSeverity.Warning);
    diag.code = 'X';
    diag.source = 'ts';

    const normalized = normalizeDiagnostics([diag], 'file:///abs/path/to/file.ts');
    expect(normalized.length).to.equal(1);
    const first = normalized[0];
    if (!first) throw new Error('Expected a normalized diagnostic');

    const canonical = buildDiagnosticCanonicalString(
      'file:///abs/path/to/file.ts',
      first.range,
      first.severity,
      first.code,
      first.source,
      first.message,
    );

    expect(first.id).to.equal(stableIdFromCanonicalString(canonical));
  });

  it('enforces MAX_ITEMS_NONPAGED deterministically', () => {
    const items = Array.from({ length: MAX_ITEMS_NONPAGED + 1 }, (_, i) => ({
      id: `sha256:${i}`,
      range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
      message: `m${i}`,
    }));

    const enforced = enforceDiagnosticsCap(items);
    expect(enforced.items.length).to.equal(MAX_ITEMS_NONPAGED);
    expect(enforced.capped).to.equal(true);
  });
});

describe('diagnostics document gating', () => {
  it('rejects invalid file URIs deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const missingPath = path.join(repoRoot, 'does-not-exist.ts');
    const missingUri = vscode.Uri.file(missingPath).toString();

    const res = await handleDiagnosticsDocument({ uri: missingUri }, { allowedRootsRealpaths });

    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/URI_INVALID');
    }
  });

  it('rejects out-of-root file URIs deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lsp-gateway-'));
    const tempFile = path.join(tempDir, 'diag.ts');
    fs.writeFileSync(tempFile, 'export const x = 1;', 'utf8');

    const tempUri = vscode.Uri.file(tempFile).toString();
    const res = await handleDiagnosticsDocument({ uri: tempUri }, { allowedRootsRealpaths });

    fs.rmSync(tempDir, { recursive: true, force: true });

    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/WORKSPACE_DENIED');
    }
  });
});
