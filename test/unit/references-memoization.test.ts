import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { handleReferences } from '../../src/tools/handlers/references.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

describe('references memoization', () => {
  it('reuses cached full set across pages', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-references-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const locations = [
      new vscode.Location(
        uri,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      ),
      new vscode.Location(
        uri,
        new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 3)),
      ),
      new vscode.Location(
        uri,
        new vscode.Range(new vscode.Position(0, 4), new vscode.Position(0, 5)),
      ),
    ];

    const disposable = vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideReferences: async () => {
          calls += 1;
          return locations;
        },
      },
    );

    try {
      const first = await handleReferences(
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
          pageSize: 1,
        },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: unknown[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      const second = await handleReferences(
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
          pageSize: 1,
          cursor: firstResult.nextCursor,
        },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(second.ok).to.equal(true);
      if (!second.ok) return;
      const secondResult = second.result as { items: unknown[]; nextCursor: string | null };
      expect(secondResult.items.length).to.equal(1);
      expect(calls).to.equal(1);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
