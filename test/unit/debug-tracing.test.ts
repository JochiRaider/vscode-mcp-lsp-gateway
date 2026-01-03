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

describe('debug tracing', () => {
  it('emits jsonrpc and tools/call traces without raw params', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry: SchemaRegistry = await SchemaRegistry.create(context);
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const output = new FakeOutputChannel();
    const logger = createLogger(output as unknown as vscode.OutputChannel, {
      debugEnabled: true,
      maxChars: 2048,
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
      logger,
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
            position: { line: 1, character: 2 },
          },
        },
      },
      { 'mcp-protocol-version': '2025-11-25' },
      3,
    );

    const joined = output.lines.join('\n');
    expect(joined).to.include('jsonrpc.in');
    expect(joined).to.include('tools.call');
    expect(joined).to.include('tools.result');
    expect(joined).to.not.include('file:///tmp/secret-path');
  });
});
