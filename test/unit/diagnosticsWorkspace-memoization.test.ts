import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { handleDiagnosticsWorkspace } from '../../src/tools/handlers/diagnosticsWorkspace.js';
import {
  computeRequestKey,
  computeSnapshotKey,
  encodeCursor,
} from '../../src/tools/paging/cursor.js';
import { LruCache } from '../../src/tools/runtime/lruCache.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

const flushMicrotasks = async (): Promise<void> =>
  new Promise((resolve) => queueMicrotask(resolve));

describe('diagnostics workspace memoization', () => {
  it('reuses cached full set across pages and keeps cursor validation', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagnostics-'));
    const fileA = path.join(tempDir, 'a.txt');
    const fileB = path.join(tempDir, 'b.txt');
    fs.writeFileSync(fileA, 'const a = 1;', 'utf8');
    fs.writeFileSync(fileB, 'const b = 2;', 'utf8');

    const uriA = vscode.Uri.file(fileA);
    const uriB = vscode.Uri.file(fileB);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();
    const collection = vscode.languages.createDiagnosticCollection('memoize-workspace');

    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      collection.set(uriA, [new vscode.Diagnostic(range, 'a', vscode.DiagnosticSeverity.Error)]);
      collection.set(uriB, [new vscode.Diagnostic(range, 'b', vscode.DiagnosticSeverity.Error)]);

      const first = await handleDiagnosticsWorkspace(
        { pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: { uri: string }[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      collection.clear();

      const second = await handleDiagnosticsWorkspace(
        { pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(second.ok).to.equal(true);
      if (!second.ok) return;
      const secondResult = second.result as { items: { uri: string }[]; nextCursor: string | null };
      expect(secondResult.items.length).to.equal(1);
      const firstItem = firstResult.items[0];
      const secondItem = secondResult.items[0];
      expect(firstItem).to.not.equal(undefined);
      expect(secondItem).to.not.equal(undefined);
      if (!firstItem || !secondItem) return;
      const returnedUris = [firstItem.uri, secondItem.uri].sort();
      expect(returnedUris).to.deep.equal([uriA.toString(), uriB.toString()].sort());

      const requestKey = computeRequestKey('vscode_lsp_diagnostics_workspace', []);
      const epochTupleString = toolRuntime.getSnapshotFingerprint(
        'vscode_lsp_diagnostics_workspace',
        allowedRootsRealpaths,
      );
      const snapshotKey = computeSnapshotKey(requestKey, epochTupleString);
      const invalidCursor = encodeCursor({ v: 2, o: 0, k: `${requestKey}x`, s: snapshotKey });
      const invalid = await handleDiagnosticsWorkspace(
        { pageSize: 1, cursor: invalidCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(invalid.ok).to.equal(false);
      if (!invalid.ok) {
        expect(invalid.error.code).to.equal(-32602);
        const data = invalid.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_INVALID');
      }
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns CURSOR_EXPIRED when snapshot is evicted', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagnostics-expired-'));
    const fileA = path.join(tempDir, 'a.txt');
    fs.writeFileSync(fileA, 'const a = 1;', 'utf8');

    const uriA = vscode.Uri.file(fileA);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();
    const collection = vscode.languages.createDiagnosticCollection('memoize-expired');

    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      collection.set(uriA, [new vscode.Diagnostic(range, 'a', vscode.DiagnosticSeverity.Error)]);

      const first = await handleDiagnosticsWorkspace(
        { pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: { uri: string }[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      toolRuntime.pagedFullSetCache.clear();

      const second = await handleDiagnosticsWorkspace(
        { pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(second.ok).to.equal(false);
      if (!second.ok) {
        expect(second.error.code).to.equal(-32602);
        const data = second.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_EXPIRED');
      }
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns CURSOR_STALE when snapshot changes', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagnostics-stale-'));
    const fileA = path.join(tempDir, 'a.txt');
    fs.writeFileSync(fileA, 'const a = 1;', 'utf8');

    const uriA = vscode.Uri.file(fileA);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();
    const collection = vscode.languages.createDiagnosticCollection('memoize-stale');

    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      collection.set(uriA, [new vscode.Diagnostic(range, 'a', vscode.DiagnosticSeverity.Error)]);

      const first = await handleDiagnosticsWorkspace(
        { pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(first.ok).to.equal(true);
      if (!first.ok) return;
      const firstResult = first.result as { items: { uri: string }[]; nextCursor: string | null };
      expect(firstResult.items.length).to.equal(1);
      expect(firstResult.nextCursor).to.be.a('string');

      toolRuntime.bumpDiagnosticsEpoch();
      await flushMicrotasks();

      const second = await handleDiagnosticsWorkspace(
        { pageSize: 1, cursor: firstResult.nextCursor },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(second.ok).to.equal(false);
      if (!second.ok) {
        expect(second.error.code).to.equal(-32602);
        const data = second.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/CURSOR_STALE');
      }
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns SNAPSHOT_TOO_LARGE when snapshot cannot be retained', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagnostics-large-'));
    const fileA = path.join(tempDir, 'a.txt');
    fs.writeFileSync(fileA, 'const a = 1;', 'utf8');

    const uriA = vscode.Uri.file(fileA);
    const allowedRootsRealpaths = [fs.realpathSync(tempDir)];
    const toolRuntime = new ToolRuntime();
    (toolRuntime as unknown as { pagedFullSetCache: LruCache<string, unknown> }).pagedFullSetCache =
      new LruCache({
        perEntryCapBytes: 1,
        totalCapBytes: 1,
        ttlMs: 0,
      });
    const collection = vscode.languages.createDiagnosticCollection('memoize-large');

    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      collection.set(uriA, [new vscode.Diagnostic(range, 'a', vscode.DiagnosticSeverity.Error)]);

      const res = await handleDiagnosticsWorkspace(
        { pageSize: 1 },
        { allowedRootsRealpaths, maxItemsPerPage: 200, toolRuntime },
      );
      expect(res.ok).to.equal(false);
      if (!res.ok) {
        expect(res.error.code).to.equal(-32602);
        const data = res.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE');
      }
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
