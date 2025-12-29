import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  enforceDocumentSymbolsCap,
  flattenDocumentSymbols,
  MAX_ITEMS_NONPAGED,
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
