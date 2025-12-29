import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { dispatchToolCall } from '../../src/tools/dispatcher';
import { SchemaRegistry } from '../../src/tools/schemaRegistry';

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
    };

    const res = await dispatchToolCall('unknown.tool', {}, deps);
    expect(res.ok).to.equal(false);
    if (!res.ok) {
      expect(res.error.code).to.equal(-32602);
      const data = res.error.data as { code?: string };
      expect(data.code).to.equal('MCP_LSP_GATEWAY/INVALID_PARAMS');
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
    };

    const res = await dispatchToolCall(
      'vscode.lsp.hover',
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
});
