import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  checkWorkspaceDiagnosticsTotalCap,
  normalizeWorkspaceDiagnosticsGroups,
} from '../../src/tools/handlers/diagnosticsWorkspace';
import { MAX_ITEMS_NONPAGED } from '../../src/tools/handlers/diagnosticsDocument';
import { computeRequestKey, encodeCursor, paginate } from '../../src/tools/paging/cursor';

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

    const normalized = await normalizeWorkspaceDiagnosticsGroups(raw, allowedRootsRealpaths);
    const uris = normalized.groups.map((g) => g.uri);

    const expected = [vscode.Uri.file(fileA).toString(), vscode.Uri.file(fileB).toString()].sort();
    expect(uris).to.deep.equal(expected);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('enforces per-file MAX_ITEMS_NONPAGED deterministically', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const fileA = path.join(repoRoot, 'docs', 'CONTRACT.md');

    const diagnostics = Array.from({ length: MAX_ITEMS_NONPAGED + 1 }, (_, i) => {
      return new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, 1)),
        `m${i}`,
        vscode.DiagnosticSeverity.Error,
      );
    });

    const raw = [[vscode.Uri.file(fileA), diagnostics]];
    const normalized = await normalizeWorkspaceDiagnosticsGroups(raw, allowedRootsRealpaths);

    expect(normalized.groups.length).to.equal(1);
    expect(normalized.groups[0].diagnostics.length).to.equal(MAX_ITEMS_NONPAGED);
    expect(normalized.groups[0].capped).to.equal(true);
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

    const requestKey = computeRequestKey('vscode.lsp.diagnostics.workspace', []);
    const paged = paginate(groups, 1, null, requestKey);
    expect(paged.ok).to.equal(true);
    if (!paged.ok) return;
    expect(paged.items.length).to.equal(1);
    expect(paged.items[0].uri).to.equal('file:///a.ts');
  });

  it('rejects cursor mismatches deterministically', () => {
    const requestKey = computeRequestKey('vscode.lsp.diagnostics.workspace', []);
    const otherKey = computeRequestKey('vscode.lsp.diagnostics.workspace', ['x']);
    const cursor = encodeCursor({ v: 1, o: 0, k: otherKey });

    const paged = paginate([], 1, cursor, requestKey);
    expect(paged.ok).to.equal(false);
    if (!paged.ok) {
      expect(paged.error.code).to.equal(-32602);
      const data = paged.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
    }
  });
});

describe('diagnostics workspace caps', () => {
  it('returns CAP_EXCEEDED when total file count exceeds max', () => {
    const err = checkWorkspaceDiagnosticsTotalCap(5001);
    expect(err).to.not.equal(undefined);
    if (!err) return;
    expect(err.code).to.equal(-32603);
    const data = err.data as { code?: string };
    expect(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
});
