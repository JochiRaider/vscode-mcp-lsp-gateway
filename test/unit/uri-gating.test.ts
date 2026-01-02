import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { canonicalizeAndGateFileUri } from '../../src/workspace/uri.js';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lsp-gateway-'));
}

function removeDir(dirPath: string): void {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup for temp directories.
  }
}

describe('workspace uri gating', () => {
  it('accepts in-root file URIs deterministically', async () => {
    const root = mkTempDir();
    try {
      const filePath = path.join(root, 'file.ts');
      fs.writeFileSync(filePath, 'export const x = 1;', 'utf8');

      const allowedRootsRealpaths = [fs.realpathSync(root)];
      const uri = vscode.Uri.file(filePath).toString();
      const res = await canonicalizeAndGateFileUri(uri, allowedRootsRealpaths);

      expect(res.ok).to.equal(true);
      if (!res.ok) return;
      expect(res.value.realPath).to.equal(fs.realpathSync(filePath));
      expect(res.value.uri).to.equal(vscode.Uri.file(res.value.realPath).toString());
    } finally {
      removeDir(root);
    }
  });

  it('rejects symlink escapes deterministically', async function () {
    const root = mkTempDir();
    const outside = mkTempDir();
    try {
      const outsideFile = path.join(outside, 'outside.ts');
      fs.writeFileSync(outsideFile, 'export const y = 2;', 'utf8');

      const linkPath = path.join(root, 'linked');
      try {
        fs.symlinkSync(outside, linkPath, 'junction');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'EPERM' || code === 'EACCES' || code === 'EINVAL') {
          this.skip();
          return;
        }
        throw err;
      }

      const escapedPath = path.join(linkPath, 'outside.ts');
      const uri = vscode.Uri.file(escapedPath).toString();
      const allowedRootsRealpaths = [fs.realpathSync(root)];

      const res = await canonicalizeAndGateFileUri(uri, allowedRootsRealpaths);
      expect(res.ok).to.equal(false);
      if (!res.ok) {
        expect(res.code).to.equal('MCP_LSP_GATEWAY/WORKSPACE_DENIED');
      }
    } finally {
      removeDir(root);
      removeDir(outside);
    }
  });
});
