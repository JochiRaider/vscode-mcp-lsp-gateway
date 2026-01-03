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

describe('mcp handler lifecycle', () => {
  it('rejects request-shaped notifications/initialized without mutating init state', async () => {
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

    const initializedAsRequest = await invokeHandler(
      handler,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'notifications/initialized',
        params: {},
      },
      { 'mcp-protocol-version': '2025-11-25' },
    );
    expect(initializedAsRequest.status).to.equal(200);
    const parsed = JSON.parse(initializedAsRequest.bodyText ?? '{}') as Record<string, unknown>;
    expect(parsed.id).to.equal(2);
    const error = parsed.error as { code?: number; message?: string } | undefined;
    expect(error?.code).to.equal(-32600);
    expect(error?.message).to.equal('Invalid Request');

    const toolsList = await invokeHandler(
      handler,
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { 'mcp-protocol-version': '2025-11-25' },
    );
    expect(toolsList.status).to.equal(200);
    const toolsListParsed = JSON.parse(toolsList.bodyText ?? '{}') as Record<string, unknown>;
    const toolsListError = toolsListParsed.error as
      | {
          code?: number;
          message?: string;
          data?: { detail?: string };
        }
      | undefined;
    expect(toolsListError?.code).to.equal(-32600);
    expect(toolsListError?.message).to.equal('Not initialized');
    expect(toolsListError?.data?.detail).to.equal('notifications/initialized not received');
  });

  it('accepts legacy initialize protocolVersion when interop flag is enabled', async () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const context = createTestContext(repoRoot);
    const schemaRegistry: SchemaRegistry = await SchemaRegistry.create(context);
    const allowedRootsRealpaths = [fs.realpathSync(repoRoot)];

    const handler = createMcpPostHandler({
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'test', version: '0.0.0' },
      enableSessions: false,
      allowLegacyInitializeProtocolVersion: true,
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
        params: { protocolVersion: '2025-06-18' },
      },
      {},
    );
    expect(init.status).to.equal(200);
    const parsedInit = JSON.parse(init.bodyText ?? '{}') as Record<string, unknown>;
    const result = parsedInit.result as { protocolVersion?: string } | undefined;
    expect(result?.protocolVersion).to.equal('2025-11-25');

    const initialized = await invokeHandler(
      handler,
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { 'mcp-protocol-version': '2025-11-25' },
    );
    expect(initialized.status).to.equal(202);
  });

  it('rejects legacy initialize protocolVersion by default', async () => {
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
        params: { protocolVersion: '2025-06-18' },
      },
      {},
    );
    expect(init.status).to.equal(200);
    const parsedInit = JSON.parse(init.bodyText ?? '{}') as Record<string, unknown>;
    const error = parsedInit.error as { code?: number; message?: string } | undefined;
    expect(error?.code).to.equal(-32602);
    expect(error?.message).to.equal('Invalid params');
  });
});
