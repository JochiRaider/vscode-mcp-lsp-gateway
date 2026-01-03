import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import * as vscode from 'vscode';
import { createLogger } from '../../src/logging/redact.js';
import { createMcpPostHandler } from '../../src/mcp/handler.js';
import type { McpPostHandler, McpPostResult } from '../../src/server/router.js';
import { SchemaRegistry } from '../../src/tools/schemaRegistry.js';
import { ToolRuntime } from '../../src/tools/runtime/toolRuntime.js';

class FakeOutputChannel {
  public lines: string[] = [];

  public appendLine(line: string): void {
    this.lines.push(line);
  }
}

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
  requestId: number,
): Promise<McpPostResult> {
  const bodyText = JSON.stringify(message);
  return await handler({
    pathname: '/mcp',
    headers,
    bodyText,
    bodyBytes: Buffer.byteLength(bodyText, 'utf8'),
    requestId,
  });
}

describe('trace logging', () => {
  it('emits bounded, sanitized JSON-RPC traces', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry: SchemaRegistry = await SchemaRegistry.create(context);
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const output = new FakeOutputChannel();
    const traceLogger = createLogger(output as unknown as vscode.OutputChannel, {
      debugEnabled: true,
      maxChars: 160,
    });

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
      traceLogger,
    });

    await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      },
      {},
      1,
    );

    await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      },
      { 'mcp-protocol-version': '2025-11-25' },
      2,
    );

    await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'unknown_tool',
          arguments: {
            uri: 'file:///tmp/secret-path',
            text: 'x'.repeat(500),
            authorization: 'Bearer secret-token',
            'mcp-session-id': 'session-123',
          },
        },
      },
      { 'mcp-protocol-version': '2025-11-25' },
      3,
    );

    const joined = output.lines.join('\n');
    expect(joined).to.include('trace.in');
    expect(joined).to.include('trace.out');
    expect(joined).to.not.include('file:///tmp/secret-path');
    expect(joined).to.not.include('secret-token');
    expect(joined).to.not.include('session-123');

    for (const line of output.lines) {
      expect(line.length).to.be.at.most(160);
    }
  });
});
