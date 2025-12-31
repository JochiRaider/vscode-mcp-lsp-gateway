import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  enforceDocumentSymbolsCap,
  flattenDocumentSymbols,
  MAX_ITEMS_NONPAGED,
  normalizeDocumentSymbolsResult,
  normalizeSymbolInformation,
} from '../../src/tools/handlers/documentSymbols';

describe('documentSymbols helpers', () => {
  it('flattens DocumentSymbol hierarchy with sorted children and containerName', () => {
    const parent = new vscode.DocumentSymbol(
      'Parent',
      '',
      vscode.SymbolKind.Class,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10)),
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)),
    );

    const childLate = new vscode.DocumentSymbol(
      'ChildB',
      '',
      vscode.SymbolKind.Method,
      new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 10)),
      new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 5)),
    );
    const childEarly = new vscode.DocumentSymbol(
      'ChildA',
      '',
      vscode.SymbolKind.Method,
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 10)),
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 5)),
    );
    parent.children = [childLate, childEarly];

    const flat = flattenDocumentSymbols([parent], 'file:///abs/path/to/file.ts', undefined);
    expect(flat.map((s) => s.name)).to.deep.equal(['Parent', 'ChildA', 'ChildB']);
    expect(flat[1].containerName).to.equal('Parent');
  });

  it('drops whitespace-only names and normalizes ranges', () => {
    const goodRange = {
      start: { line: 2, character: 3 },
      end: { line: 1, character: 1 },
    } as vscode.Range;
    const badRange = {
      start: { line: -1, character: 4 },
      end: { line: 0, character: -2 },
    } as vscode.Range;

    const good = {
      name: 'Good',
      detail: '',
      kind: vscode.SymbolKind.Function,
      range: goodRange,
      selectionRange: badRange,
      children: [],
    } as vscode.DocumentSymbol;
    const bad = {
      name: '   ',
      detail: '',
      kind: vscode.SymbolKind.Function,
      range: goodRange,
      selectionRange: goodRange,
      children: [],
    } as vscode.DocumentSymbol;

    const flat = flattenDocumentSymbols([bad, good], 'file:///abs/path/to/file.ts', undefined);
    expect(flat.map((s) => s.name)).to.deep.equal(['Good']);
    expect(flat[0].range).to.deep.equal({
      start: { line: 1, character: 1 },
      end: { line: 2, character: 3 },
    });
    expect(flat[0].selectionRange).to.deep.equal({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    });
  });

  it('normalizes SymbolInformation with stable id and selectionRange', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const filePath = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const location = new vscode.Location(
      vscode.Uri.file(filePath),
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 4)),
    );
    const sym = new vscode.SymbolInformation(
      'MySymbol',
      vscode.SymbolKind.Function,
      'Container',
      location,
    );

    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const normalized = await normalizeSymbolInformation(sym, allowedRootsRealpaths);
    expect(normalized).to.not.equal(undefined);
    if (!normalized) return;
    expect(normalized.id).to.match(/^sha256:[0-9a-f]{64}$/);
    expect(normalized.selectionRange).to.deep.equal(normalized.range);
  });

  it('drops whitespace-only SymbolInformation names', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const filePath = path.join(repoRoot, 'docs', 'CONTRACT.md');
    const location = new vscode.Location(
      vscode.Uri.file(filePath),
      new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 4)),
    );
    const sym = new vscode.SymbolInformation(
      '   ',
      vscode.SymbolKind.Function,
      'Container',
      location,
    );

    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];
    const normalized = await normalizeSymbolInformation(sym, allowedRootsRealpaths);
    expect(normalized).to.equal(undefined);
  });

  it('returns CAP_EXCEEDED when traversal cap is exceeded', async () => {
    const symbols = Array.from({ length: 4 }, (_, i) => ({
      name: `S${i}`,
      detail: '',
      kind: vscode.SymbolKind.Function,
      range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, 1)),
      selectionRange: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, 1)),
      children: [],
    })) as vscode.DocumentSymbol[];

    const result = await normalizeDocumentSymbolsResult(
      symbols,
      'file:///abs/path/to/file.ts',
      [],
      3,
    );
    expect(result.ok).to.equal(false);
    if (result.ok) return;
    expect(result.error.code).to.equal(-32603);
    const data = result.error.data as { code?: string };
    expect(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });

  it('enforces MAX_ITEMS_NONPAGED via deterministic truncation', () => {
    const items = Array.from({ length: MAX_ITEMS_NONPAGED + 1 }, (_, i) => ({
      id: `sha256:${i}`,
      name: `S${i}`,
      kind: 1,
      range: {
        start: { line: i, character: 0 },
        end: { line: i, character: 1 },
      },
      selectionRange: {
        start: { line: i, character: 0 },
        end: { line: i, character: 1 },
      },
    }));

    const enforced = enforceDocumentSymbolsCap(items);
    expect(enforced.items.length).to.equal(MAX_ITEMS_NONPAGED);
    expect(enforced.capped).to.equal(true);
  });
});
