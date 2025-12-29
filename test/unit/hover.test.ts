import { expect } from 'chai';
import * as vscode from 'vscode';
import { normalizeHoverContents, pickStableRange } from '../../src/tools/handlers/hover';

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

    const normalizedA = normalizeHoverContents([hoverA]);
    const normalizedB = normalizeHoverContents([hoverB]);

    const expected = [
      { kind: 'markdown', value: 'Bravo' },
      { kind: 'markdown', value: 'Zulu' },
      { kind: 'plaintext', value: 'Alpha' },
    ];

    expect(normalizedA).to.deep.equal(expected);
    expect(normalizedB).to.deep.equal(expected);
  });

  it('formats MarkedString language entries as fenced code', () => {
    const hover = new vscode.Hover([{ language: 'ts', value: 'const x = 1;' }]);
    const normalized = normalizeHoverContents([hover]);
    expect(normalized).to.deep.equal([{ kind: 'markdown', value: '```ts\nconst x = 1;\n```' }]);
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

    const picked = pickStableRange([first, second]);
    expect(picked).to.deep.equal({
      start: { line: 1, character: 5 },
      end: { line: 1, character: 7 },
    });
  });

  it('returns undefined when no hover ranges are available', () => {
    const hover = new vscode.Hover(['A']);
    const picked = pickStableRange([hover]);
    expect(picked).to.equal(undefined);
  });
});
