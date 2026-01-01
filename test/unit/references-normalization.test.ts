import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  MAX_REFERENCES_ITEMS_RAW,
  checkReferencesRawCap,
  normalizeReferenceResult,
} from '../../src/tools/handlers/references.js';

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

describe('references normalization', () => {
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

    const normalized = await normalizeReferenceResult([link], allowedRootsRealpaths);
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

  it('drops items that throw during normalization', async () => {
    const root = repoRoot();
    const allowedRootsRealpaths = [fs.realpathSync(root)];
    const filePath = path.join(root, 'docs', 'CONTRACT.md');

    const badUri = Object.create(vscode.Uri.prototype) as vscode.Uri;
    (badUri as unknown as { toString(): string }).toString = () => {
      throw new Error('boom');
    };

    const badLoc = {
      uri: badUri,
      range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 1)),
    } as vscode.Location;

    const goodLoc = {
      uri: vscode.Uri.file(filePath),
      range: new vscode.Range(new vscode.Position(3, 0), new vscode.Position(3, 4)),
    } as vscode.Location;

    const normalized = await normalizeReferenceResult([badLoc, goodLoc], allowedRootsRealpaths);
    expect(normalized).to.deep.equal([
      {
        uri: vscode.Uri.file(filePath).toString(),
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 4 },
        },
      },
    ]);
  });

  it('filters out-of-root locations', async () => {
    const root = repoRoot();
    const allowedRootsRealpaths = [fs.realpathSync(path.join(root, 'schemas'))];
    const filePath = path.join(root, 'docs', 'CONTRACT.md');

    const loc = {
      uri: vscode.Uri.file(filePath),
      range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 1)),
    } as vscode.Location;

    const normalized = await normalizeReferenceResult([loc], allowedRootsRealpaths);
    expect(normalized).to.deep.equal([]);
  });
});

describe('references raw cap', () => {
  it('returns CAP_EXCEEDED when raw array exceeds deterministic cap', () => {
    const raw = new Array(MAX_REFERENCES_ITEMS_RAW + 1);
    const err = checkReferencesRawCap(raw);
    expect(err).to.not.equal(undefined);
    if (!err) return;
    expect(err.code).to.equal(-32603);
    const data = err.data as { code?: string };
    expect(data.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
  });
});
