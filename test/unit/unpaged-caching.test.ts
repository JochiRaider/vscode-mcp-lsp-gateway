import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { handleDefinition } from '../../src/tools/handlers/definition.js';
import { handleDiagnosticsDocument } from '../../src/tools/handlers/diagnosticsDocument.js';
import { handleDocumentSymbols } from '../../src/tools/handlers/documentSymbols.js';
import { handleHover } from '../../src/tools/handlers/hover.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

describe('unpaged tool caching', () => {
  it('caches hover results by document version', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-hover-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const disposable = vscode.languages.registerHoverProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideHover: async () => {
          calls += 1;
          return new vscode.Hover(['hello']);
        },
      },
    );

    try {
      const first = await handleHover(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      const second = await handleHover(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(second.ok).to.equal(true);
      expect(calls).to.equal(1);

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      await vscode.workspace.applyEdit(edit);

      const third = await handleHover(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(third.ok).to.equal(true);
      expect(calls).to.equal(2);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('caches definition results by document version', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-definition-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const location = new vscode.Location(
      uri,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
    );

    const disposable = vscode.languages.registerDefinitionProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideDefinition: async () => {
          calls += 1;
          return [location];
        },
      },
    );

    try {
      const first = await handleDefinition(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      const second = await handleDefinition(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(second.ok).to.equal(true);
      expect(calls).to.equal(1);

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      await vscode.workspace.applyEdit(edit);

      const third = await handleDefinition(
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(third.ok).to.equal(true);
      expect(calls).to.equal(2);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('caches document symbols by document version', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-docsymbols-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const symbol = new vscode.DocumentSymbol(
      'X',
      '',
      vscode.SymbolKind.Function,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
    );

    const disposable = vscode.languages.registerDocumentSymbolProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideDocumentSymbols: async () => {
          calls += 1;
          return [symbol];
        },
      },
    );

    try {
      const first = await handleDocumentSymbols(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      const second = await handleDocumentSymbols(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(second.ok).to.equal(true);
      expect(calls).to.equal(1);

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      await vscode.workspace.applyEdit(edit);

      const third = await handleDocumentSymbols(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(third.ok).to.equal(true);
      expect(calls).to.equal(2);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('caches diagnostics by document version when the document is open', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagdoc-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    const doc = await vscode.workspace.openTextDocument(uri);
    const collection = vscode.languages.createDiagnosticCollection('diag-doc-cache');
    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      collection.set(uri, [new vscode.Diagnostic(range, 'a', vscode.DiagnosticSeverity.Error)]);

      const first = await handleDiagnosticsDocument(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(first.ok).to.equal(true);

      collection.clear();

      const second = await handleDiagnosticsDocument(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(second.ok).to.equal(true);
      if (second.ok) {
        expect(second.result.diagnostics.length).to.equal(1);
      }

      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), ' ');
      await vscode.workspace.applyEdit(edit);
      expect(doc.version).to.be.greaterThan(0);

      const third = await handleDiagnosticsDocument(
        { uri: uri.toString() },
        { allowedRootsRealpaths, toolRuntime },
      );
      expect(third.ok).to.equal(true);
      if (third.ok) {
        expect(third.result.diagnostics.length).to.equal(0);
      }
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
