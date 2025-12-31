'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs = require('node:fs');
const path = require('node:path');
const chai_1 = require('chai');
const vscode = require('vscode');
const documentSymbols_1 = require('../../src/tools/handlers/documentSymbols');
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
    const flat = (0, documentSymbols_1.flattenDocumentSymbols)(
      [parent],
      'file:///abs/path/to/file.ts',
      undefined,
    );
    (0, chai_1.expect)(flat.map((s) => s.name)).to.deep.equal(['Parent', 'ChildA', 'ChildB']);
    (0, chai_1.expect)(flat[1].containerName).to.equal('Parent');
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
    const normalized = await (0, documentSymbols_1.normalizeSymbolInformation)(
      sym,
      allowedRootsRealpaths,
    );
    (0, chai_1.expect)(normalized).to.not.equal(undefined);
    if (!normalized) return;
    (0, chai_1.expect)(normalized.id).to.match(/^sha256:[0-9a-f]{64}$/);
    (0, chai_1.expect)(normalized.selectionRange).to.deep.equal(normalized.range);
  });
  it('enforces MAX_ITEMS_NONPAGED via deterministic truncation', () => {
    const items = Array.from({ length: documentSymbols_1.MAX_ITEMS_NONPAGED + 1 }, (_, i) => ({
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
    const enforced = (0, documentSymbols_1.enforceDocumentSymbolsCap)(items);
    (0, chai_1.expect)(enforced.items.length).to.equal(documentSymbols_1.MAX_ITEMS_NONPAGED);
    (0, chai_1.expect)(enforced.capped).to.equal(true);
  });
});
//# sourceMappingURL=documentSymbols.test.js.map
