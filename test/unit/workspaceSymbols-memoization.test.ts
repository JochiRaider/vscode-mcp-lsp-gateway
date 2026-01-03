import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { handleWorkspaceSymbols } from '../../src/tools/handlers/workspaceSymbols.js';
import {
  computeRequestKey,
  computeSnapshotKey,
  encodeCursor,
} from '../../src/tools/paging/cursor.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

const flushMicrotasks = async (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));

describe('workspaceSymbols memoization', () => {
  it('reuses cached full set across pages', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    const symbols = [
      new vscode.SymbolInformation(
        'One',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
      new vscode.SymbolInformation(
        'Two',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 3)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => {
        calls += 1;
        return symbols;
      },
    });

    try {
      const first = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: unknown[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      const second = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(second.ok).to.equal(true);
      if (!second.ok) return;
      const secondResult = second.result as { items: unknown[]; nextCursor: string | null };
      expect(secondResult.items.length).to.equal(1);
      expect(calls).to.equal(1);

      const requestKey = computeRequestKey('vscode_lsp_workspaceSymbols', ['foo']);
      const epochTupleString = toolRuntime.getSnapshotFingerprint(
        'vscode_lsp_workspaceSymbols',
        allowedRootsRealpaths,
      );
      const snapshotKey = computeSnapshotKey(requestKey, epochTupleString);
      const cursor = encodeCursor({ v: 2, o: 0, k: `${requestKey}x`, s: snapshotKey });
      const invalid = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(invalid.ok).to.equal(false);
      if (!invalid.ok) {
        expect(invalid.error.code).to.equal(-32602);
        const data = invalid.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
      }
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent snapshot creation by snapshot key', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-coalesce-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const symbols = [
      new vscode.SymbolInformation(
        'One',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
      new vscode.SymbolInformation(
        'Two',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 3)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => {
        calls += 1;
        await gate;
        return symbols;
      },
    });

    try {
      const first = handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      const second = handleWorkspaceSymbols(
        { query: 'foo', pageSize: 2 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      await Promise.resolve();
      release?.();

      const [firstRes, secondRes] = await Promise.all([first, second]);
      expect(firstRes.ok).to.equal(true);
      expect(secondRes.ok).to.equal(true);
      expect(calls).to.equal(1);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns CURSOR_EXPIRED when snapshot is evicted', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-expired-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    const symbols = [
      new vscode.SymbolInformation(
        'One',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
      new vscode.SymbolInformation(
        'Two',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 2), new vscode.Position(0, 3)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => symbols,
    });

    try {
      const first = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: unknown[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      toolRuntime.pagedFullSetCache.clear();

      const second = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(second.ok).to.equal(false);
      if (!second.ok) {
        expect(second.error.code).to.equal(-32602);
        const data = second.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_EXPIRED');
      }
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns CURSOR_STALE when snapshot changes', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-stale-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    const symbols = [
      new vscode.SymbolInformation(
        'One',
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => symbols,
    });

    try {
      const first = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: unknown[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      toolRuntime.bumpTextEpoch();
      await flushMicrotasks();

      const second = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(second.ok).to.equal(false);
      if (!second.ok) {
        expect(second.error.code).to.equal(-32602);
        const data = second.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_STALE');
      }
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns SNAPSHOT_TOO_LARGE when snapshot cannot be retained', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-workspace-symbols-large-'));
    const tempFile = path.join(tempDir, 'file.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();

    const largeName = 'a'.repeat(2_200_000);
    const symbols = [
      new vscode.SymbolInformation(
        largeName,
        vscode.SymbolKind.Function,
        '',
        new vscode.Location(
          uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
        ),
      ),
    ];

    const disposable = vscode.languages.registerWorkspaceSymbolProvider({
      provideWorkspaceSymbols: async () => symbols,
    });

    try {
      const res = await handleWorkspaceSymbols(
        { query: 'foo', pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );

      expect(res.ok).to.equal(false);
      if (!res.ok) {
        expect(res.error.code).to.equal(-32602);
        const data = res.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE');
      }
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
