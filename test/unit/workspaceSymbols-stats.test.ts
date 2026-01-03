import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { createLogger } from '../../src/logging/redact.js';
import { handleWorkspaceSymbols } from '../../src/tools/handlers/workspaceSymbols.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

class FakeOutputChannel {
  public lines: string[] = [];

  public appendLine(line: string): void {
    this.lines.push(line);
  }
}

describe('workspaceSymbols stats logging', () => {
  it('logs provider and out-of-root counts', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-stats-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const inRootUri = vscode.Uri.file(tempFile);
    const outOfRootUri = vscode.Uri.file(path.join(repoRoot, 'docs', 'CONTRACT.md'));
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];

    const output = new FakeOutputChannel();
    const traceLogger = createLogger(output as unknown as vscode.OutputChannel, {
      debugEnabled: true,
      maxChars: 2048,
    });

    const symbols = [
      new vscode.SymbolInformation(
        'InRoot',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          inRootUri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
      new vscode.SymbolInformation(
        'OutOfRoot',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          outOfRootUri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => symbols,
    });

    try {
      const res = await handleWorkspaceSymbols(
        { query: 'foo' },
        {
          allowedRootsRealpaths,
          maxItemsPerPage: 200,
          toolRuntime: new ToolRuntime(),
          traceLogger,
        },
      );
      expect(res.ok).to.equal(true);

      const joined = output.lines.join('\n');
      expect(joined).to.include('workspaceSymbols.stats');
      expect(joined).to.include('"providerCount":2');
      expect(joined).to.include('"inRootCount":1');
      expect(joined).to.include('"droppedOutOfRootCount":1');
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
