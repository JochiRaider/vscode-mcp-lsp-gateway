import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { dispatchToolCall } from '../../src/tools/dispatcher.js';
import { computeRequestKey, computeSnapshotKey } from '../../src/tools/paging/cursor.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';
import { SchemaRegistry } from '../../src/tools/schemaRegistry.js';
import { canonicalizeAndGateFileUri } from '../../src/workspace/uri.js';

function createTestContext(repoRoot: string): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file(repoRoot),
    asAbsolutePath: (relPath: string) => path.join(repoRoot, relPath),
  } as unknown as vscode.ExtensionContext;
}

describe('dispatcher', () => {
  it('returns INVALID_PARAMS for unknown tool names', async () => {
    const deps = {
      schemaRegistry: {} as SchemaRegistry,
      allowedRootsRealpaths: [],
      maxItemsPerPage: 200,
      requestTimeoutMs: 1000,
      toolRuntime: new ToolRuntime(),
    };

    for (const name of ['unknown.tool', 'vscode.lsp.hover']) {
      const res = await dispatchToolCall(name, {}, deps);
      expect(res.ok).to.equal(false);
      if (!res.ok) {
        expect(res.error.code).to.equal(-32602);
        const data = res.error.data as { code?: string };
        expect(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
      }
    }
  });

  it('returns INVALID_PARAMS for schema failures before handler gating', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);
    const deps = {
      schemaRegistry,
      allowedRootsRealpaths: [],
      maxItemsPerPage: 200,
      requestTimeoutMs: 1000,
      toolRuntime: new ToolRuntime(),
    };

    const res = await dispatchToolCall(
      'vscode_lsp_hover',
      { uri: 'file:///does-not-matter', position: { line: -1, character: 0 } },
      deps,
    );
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
    }
  });

  it('coalesces concurrent identical calls via singleflight', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-dispatcher-'));
    const tempFile = path.join(tempDir, 'a.txt');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const deps = {
      schemaRegistry,
      allowedRootsRealpaths: [fs.realpathSync(tempDir)],
      maxItemsPerPage: 200,
      requestTimeoutMs: 500,
      toolRuntime: new ToolRuntime(),
    };

    let callCount = 0;
    const locations = [
      new vscode.Location(
        uri,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
      ),
    ];
    const disposable = vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideReferences: async () => {
          callCount += 1;
          return locations;
        },
      },
    );

    try {
      const p1 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        deps,
      );
      const p2 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        deps,
      );

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(callCount).to.equal(1);
      expect(r1.ok).to.equal(true);
      expect(r2.ok).to.equal(true);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('shares rejection and timeout across followers', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-dispatcher-'));
    const tempFile = path.join(tempDir, 'b.txt');
    fs.writeFileSync(tempFile, 'const y = 2;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const deps = {
      schemaRegistry,
      allowedRootsRealpaths: [fs.realpathSync(tempDir)],
      maxItemsPerPage: 200,
      requestTimeoutMs: 5,
      toolRuntime: new ToolRuntime(),
    };

    let callCount = 0;
    const disposable = vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideReferences: async () => {
          callCount += 1;
          throw new Error('boom');
        },
      },
    );

    try {
      const p1 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        deps,
      );
      const p2 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        deps,
      );

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(callCount).to.equal(1);
      expect(r1.ok).to.equal(false);
      expect(r2.ok).to.equal(false);
      if (!r1.ok && !r2.ok) {
        expect(r1.error.code).to.equal(-32603);
        expect(r2.error.code).to.equal(-32603);
      }
    } finally {
      disposable.dispose();
    }

    let slowCalls = 0;
    const slowDeps = {
      ...deps,
      requestTimeoutMs: 10,
      toolRuntime: new ToolRuntime(),
    };

    const slowDisposable = vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideReferences: () => {
          slowCalls += 1;
          return new Promise((resolve) => {
            setTimeout(() => resolve([]), 50);
          });
        },
      },
    );

    try {
      const s1 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        slowDeps,
      );
      const s2 = dispatchToolCall(
        'vscode_lsp_references',
        {
          uri: uri.toString(),
          position: { line: 0, character: 0 },
        },
        slowDeps,
      );

      const [r1, r2] = await Promise.all([s1, s2]);
      expect(slowCalls).to.equal(1);
      expect(r1.ok).to.equal(false);
      expect(r2.ok).to.equal(false);
      if (!r1.ok && !r2.ok) {
        const code1 = (r1.error.data as { code?: string }).code;
        const code2 = (r2.error.data as { code?: string }).code;
        expect(code1).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
        expect(code2).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
      }
    } finally {
      slowDisposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('does not mutate paged caches after a timeout', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry = await SchemaRegistry.create(context);
    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-dispatcher-timeout-'));
    const tempFile = path.join(tempDir, 'c.txt');
    fs.writeFileSync(tempFile, 'const z = 3;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const toolRuntime = new ToolRuntime();
    const deps = {
      schemaRegistry,
      allowedRootsRealpaths: [fs.realpathSync(tempDir)],
      maxItemsPerPage: 200,
      requestTimeoutMs: 5,
      toolRuntime,
    };

    const disposable = vscode.languages.registerReferenceProvider(
      { scheme: 'file', language: 'plaintext' },
      {
        provideReferences: () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve([
                  new vscode.Location(
                    uri,
                    new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
                  ),
                ]),
              50,
            );
          }),
      },
    );

    try {
      const res = await dispatchToolCall(
        'vscode_lsp_references',
        { uri: uri.toString(), position: { line: 0, character: 0 } },
        deps,
      );
      expect(res.ok).to.equal(false);
      if (!res.ok) {
        const code = (res.error.data as { code?: string }).code;
        expect(code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
      }

      await new Promise((resolve) => setTimeout(resolve, 80));

      const gated = await canonicalizeAndGateFileUri(uri.toString(), deps.allowedRootsRealpaths);
      expect(gated.ok).to.equal(true);
      if (!gated.ok) return;
      const requestKey = computeRequestKey('vscode_lsp_references', [gated.value.uri, 0, 0, false]);
      const epochTupleString = toolRuntime.getSnapshotFingerprint(
        'vscode_lsp_references',
        deps.allowedRootsRealpaths,
      );
      const snapshotKey = computeSnapshotKey(requestKey, epochTupleString);
      const cached = toolRuntime.pagedFullSetCache.get(snapshotKey);
      expect(cached).to.equal(undefined);
    } finally {
      disposable.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
