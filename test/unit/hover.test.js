'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const vscode = require('vscode');
const hover_1 = require('../../src/tools/handlers/hover');
describe('hover normalization', () => {
  it('normalizes and sorts hover contents deterministically', () => {
    const hoverA = new vscode.Hover(
      [new vscode.MarkdownString('Bravo'), { kind: 'plaintext', value: 'Alpha' }, 'Zulu'],
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 2)),
    );
    const hoverB = new vscode.Hover(
      ['Zulu', { kind: 'plaintext', value: 'Alpha' }, new vscode.MarkdownString('Bravo')],
      new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 2)),
    );
    const normalizedA = (0, hover_1.normalizeHoverContents)([hoverA]);
    const normalizedB = (0, hover_1.normalizeHoverContents)([hoverB]);
    const expected = [
      { kind: 'markdown', value: 'Bravo' },
      { kind: 'markdown', value: 'Zulu' },
      { kind: 'plaintext', value: 'Alpha' },
    ];
    (0, chai_1.expect)(normalizedA).to.deep.equal(expected);
    (0, chai_1.expect)(normalizedB).to.deep.equal(expected);
  });
  it('formats MarkedString language entries as fenced code', () => {
    const hover = new vscode.Hover([{ language: 'ts', value: 'const x = 1;' }]);
    const normalized = (0, hover_1.normalizeHoverContents)([hover]);
    (0, chai_1.expect)(normalized).to.deep.equal([
      { kind: 'markdown', value: '```ts\nconst x = 1;\n```' },
    ]);
  });
});
describe('hover ranges', () => {
  it('picks the canonical smallest range when multiple hovers include ranges', () => {
    const first = new vscode.Hover(
      ['A'],
      new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 2)),
    );
    const second = new vscode.Hover(
      ['B'],
      new vscode.Range(new vscode.Position(1, 5), new vscode.Position(1, 7)),
    );
    const picked = (0, hover_1.pickStableRange)([first, second]);
    (0, chai_1.expect)(picked).to.deep.equal({
      start: { line: 1, character: 5 },
      end: { line: 1, character: 7 },
    });
  });
  it('returns undefined when no hover ranges are available', () => {
    const hover = new vscode.Hover(['A']);
    const picked = (0, hover_1.pickStableRange)([hover]);
    (0, chai_1.expect)(picked).to.equal(undefined);
  });
});
//# sourceMappingURL=hover.test.js.map
