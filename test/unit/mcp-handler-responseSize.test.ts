import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { createMcpPostHandler } from '../../src/mcp/handler.js';
import type { McpPostHandler, McpPostResult } from '../../src/server/router.js';
import { SchemaRegistry } from '../../src/tools/schemaRegistry.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

function createTestContext(repoRoot: string): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file(repoRoot),
    asAbsolutePath: (relPath: string) => path.join(repoRoot, relPath),
  } as unknown as vscode.ExtensionContext;
}

async function invokeHandler(
  handler: McpPostHandler,
  message: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<McpPostResult> {
  const bodyText = JSON.stringify(message);
  return await handler({
    pathname: '/mcp',
    headers,
    bodyText,
    bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
  });
}

describe('mcp handler response size', () => {
  it('returns CAP_EXCEEDED when response exceeds maxResponseBytes', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry: SchemaRegistry = await SchemaRegistry.create(context);
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const handler = createMcpPostHandler({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'test', version: '0.0.0' },
      enableSessions: false,
      schemaRegistry,
      toolRuntime: new ToolRuntime(),
      maxItemsPerPage: 200,
      maxResponseBytes: 200,
      requestTimeoutMs: 1000,
      allowedRootsRealpaths,
    });

    const init = await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      },
      {},
    );
    expect(init.status).to.equal(200);

    const initialized = await invokeHandler(
      handler,
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { 'mcp-protocol-version': '2025-11-25' },
    );
    expect(initialized.status).to.equal(202);

    const tempDir = fs.mkdtempSync(path.join(repoRoot, 'tmp-diagnostics-'));
    const tempFile = path.join(tempDir, 'diag.ts');
    fs.writeFileSync(tempFile, 'const x = 1;', 'utf8');

    const uri = vscode.Uri.file(tempFile);
    const collection = vscode.languages.createDiagnosticCollection('cap-exceeded');

    try {
      const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      const bigMessage = 'x'.repeat(1000);
      const diag = new vscode.Diagnostic(range, bigMessage, vscode.DiagnosticSeverity.Error);
      collection.set(uri, [diag]);

      const res = await invokeHandler(
        handler,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'vscode.lsp.diagnostics.document',
            arguments: { uri: uri.toString() },
          },
        },
        { 'mcp-protocol-version': '2025-11-25' },
      );

      expect(res.status).to.equal(200);
      const parsed = JSON.parse(res.bodyText ?? '{}') as Record<string, unknown>;
      const error = parsed.error as { code?: number; data?: { code?: string } } | undefined;
      expect(error?.code).to.equal(-32603);
      expect(error?.data?.code).to.equal('MCP_LSP_GATEWAY/CAP_EXCEEDED');
    } finally {
      collection.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
