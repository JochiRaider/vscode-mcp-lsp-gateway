import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { handleWorkspaceSymbols } from '../../src/tools/handlers/workspaceSymbols.js';
import { encodeCursor, computeRequestKey } from '../../src/tools/paging/cursor.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

describe('workspaceSymbols memoization', () => {
  it('reuses cached full set across pages', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const symbols = [
      new vscode.SymbolInformation(
        'One',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
      new vscode.SymbolInformation(
        'Two',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 3)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => {
        calls += 1;
        return symbols;
      },
    });

    try {
      const first = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: unknown[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      const second = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(second.ok).to.equal(true);
      if (!second.ok) return;
      const secondResult = second.result as { items: unknown[]; nextCursor: string | null };
      expect(secondResult.items.length).to.equal(1);
      expect(calls).to.equal(1);

      const requestKey = computeRequestKey('vscode.lsp.workspaceSymbols', ['foo']);
      const cursor = encodeCursor({ v: 1, o: 0, k: `${requestKey}x` });
      const invalid = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(invalid.ok).to.equal(false);
      if (!invalid.ok) {
        expect(invalid.error.code).to.equal(-32602);
        const data = invalid.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
      }
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
