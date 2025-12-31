import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  isPositionInDocument,
  normalizeDefinitionResult,
} from '../../src/tools/handlers/definition';

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

describe('definition normalization', () => {
  it('falls back to targetRange when targetSelectionRange is not a vscode.Range', async () => {
    const root = repoRoot();
    const allowedRootsRealpaths = [fs.realpathSync(root)];
    const filePath = path.join(root, 'docs', 'CONTRACT.md');

    const targetRange = new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 3));
    const link: vscode.LocationLink = {
      targetUri: vscode.Uri.file(filePath),
      targetRange,
      targetSelectionRange: { start: 1 } as unknown as vscode.Range,
    };

    const normalized = await normalizeDefinitionResult([link], allowedRootsRealpaths);
    expect(normalized).to.deep.equal([
      {
        uri: vscode.Uri.file(filePath).toString(),
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 3 },
        },
      },
    ]);
  });
});

describe('definition position validation', () => {
  it('accepts positions within line bounds', () => {
    const doc = {
      lineCount: 2,
      lineAt: (line: number) => ({
        text: line === 0 ? 'abc' : '',
      }),
    } as unknown as vscode.TextDocument;

    expect(isPositionInDocument(doc, { line: 0, character: 0 })).to.equal(true);
    expect(isPositionInDocument(doc, { line: 0, character: 3 })).to.equal(true);
  });

  it('rejects positions outside line bounds', () => {
    const doc = {
      lineCount: 2,
      lineAt: (line: number) => ({
        text: line === 0 ? 'abc' : '',
      }),
    } as unknown as vscode.TextDocument;

    expect(isPositionInDocument(doc, { line: 2, character: 0 })).to.equal(false);
    expect(isPositionInDocument(doc, { line: 0, character: 4 })).to.equal(false);
  });
});
