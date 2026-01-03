import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { createMcpPostHandler } from '../../src/mcp/handler.js';
import type { McpPostHandler, McpPostResult } from '../../src/server/router.js';
import type { SchemaRegistry } from '../../src/tools/schemaRegistry.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

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

describe('mcp handler internal errors', () => {
  it('sanitizes unexpected exceptions during tools/call', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const schemaRegistry = {
      validateInput: () => {
        throw new Error('boom /tmp/secret');
      },
      getInputSchema: () => ({}),
      getOutputSchema: () => ({}),
    } as unknown as SchemaRegistry;

    const handler = createMcpPostHandler({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'test', version: '0.0.0' },
      enableSessions: false,
      schemaRegistry,
      toolRuntime: new ToolRuntime(),
      maxItemsPerPage: 200,
      maxResponseBytes: 1024 * 1024,
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

    const res = await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'vscode_lsp_hover',
          arguments: { uri: 'file:///tmp/test.ts', position: { line: 0, character: 0 } },
        },
      },
      { 'mcp-protocol-version': '2025-11-25' },
    );

    expect(res.status).to.equal(200);
    const parsed = JSON.parse(res.bodyText ?? '{}') as Record<string, unknown>;
    const error = parsed.error as { code?: number; message?: string; data?: unknown } | undefined;
    expect(error?.code).to.equal(-32603);
    expect(error?.message).to.equal('Internal error');
    expect(error?.data).to.deep.equal({ code: 'MCP_LSP_GATEWAY/INTERNAL' });

    const serialized = JSON.stringify(error ?? {});
    expect(serialized).to.not.include('stack');
    expect(serialized).to.not.include('Error');
  });
});
