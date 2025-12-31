import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import {
  handleWorkspaceSymbols,
  normalizeWorkspaceSymbols,
} from '../../src/tools/handlers/workspaceSymbols';

function repoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

describe('workspace symbols normalization', () => {
  it('rejects whitespace-only query strings', async () => {
    const res = await handleWorkspaceSymbols(
      { query: '   ' },
      { allowedRootsRealpaths: [], maxItemsPerPage: 100 },
    );
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
    }
  });

  it('accepts location-like objects, validates ranges, and caches canonicalization', async () => {
    const root = repoRoot();
    const allowedRootsRealpaths = [fs.realpathSync(root)];
    const filePath = path.join(root, 'docs', 'CONTRACT.md');
    const uri = vscode.Uri.file(filePath);

    const location = new vscode.Location(
      uri,
      new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 3)),
    );

    const locationLike = {
      uri,
      range: new vscode.Range(new vscode.Position(2, 0), new vscode.Position(2, 2)),
    };

    const invalidRange = Object.create(vscode.Range.prototype) as vscode.Range;
    (invalidRange as unknown as { start: { line: number; character: number } }).start = {
      line: -1,
      character: 0,
    };
    (invalidRange as unknown as { end: { line: number; character: number } }).end = {
      line: 0,
      character: 1,
    };

    const invalidLocationLike = { uri, range: invalidRange };

    const raw = [
      { name: 'Alpha', kind: 1, location },
      { name: 'Beta', kind: 2, location: locationLike },
      { name: 'Bad', kind: 3, location: invalidLocationLike },
    ];

    const calls: string[] = [];
    const canonicalize = (uriString: string) => {
      calls.push(uriString);
      const fsPath = vscode.Uri.parse(uriString, true).fsPath;
      return Promise.resolve({
        ok: true as const,
        value: { uri: uriString, fsPath, realPath: fs.realpathSync(fsPath) },
      });
    };

    const normalized = await normalizeWorkspaceSymbols(raw, allowedRootsRealpaths, canonicalize);
    expect(normalized.map((item) => item.name)).to.deep.equal(['Alpha', 'Beta']);
    const first = normalized[0];
    const second = normalized[1];
    expect(first).to.not.equal(undefined);
    expect(second).to.not.equal(undefined);
    if (!first || !second) throw new Error('Missing normalized symbols');
    expect(first.location).to.deep.equal({
      uri: uri.toString(),
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
    });
    expect(second.location).to.deep.equal({
      uri: uri.toString(),
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } },
    });
    expect(calls.length).to.equal(1);
  });
});
