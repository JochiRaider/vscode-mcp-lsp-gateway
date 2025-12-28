import { expect } from 'chai';
import type * as vscode from 'vscode';
import { HttpServer, type GatewaySettings } from '../../src/server/httpServer';

class FakeOutputChannel {
  public appendLine(): void {
    // noop
  }
}

describe('http server auth', () => {
  it('refuses to start when no bearer tokens are configured', async () => {
    const settings: GatewaySettings = {
      enabled: true,
      bindAddress: '127.0.0.1',
      port: 3939,
      endpointPath: '/mcp',
      secretStorageKey: 'mcpLspGateway.authTokens',
      allowedOrigins: [],
      additionalAllowedRoots: [],
      enableSessions: true,
      maxItemsPerPage: 200,
      maxResponseBytes: 524_288,
      requestTimeoutMs: 2_000,
      debugLogging: false,
    };

    const secrets = {
      get: () => Promise.resolve(undefined),
    } as unknown as vscode.SecretStorage;

    const server = new HttpServer({
      settings,
      secrets,
      output: new FakeOutputChannel() as unknown as vscode.OutputChannel,
    });

    let err: unknown;
    try {
      await server.start();
    } catch (caught) {
      err = caught;
    }

    expect(err).to.be.instanceOf(Error);
    expect(String(err)).to.include('No bearer tokens configured');
  });
});
