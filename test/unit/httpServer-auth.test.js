'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const httpServer_1 = require('../../src/server/httpServer');
class FakeOutputChannel {
  appendLine() {
    // noop
  }
}
describe('http server auth', () => {
  it('refuses to start when no bearer tokens are configured', async () => {
    const settings = {
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
    };
    const server = new httpServer_1.HttpServer({
      settings,
      secrets,
      output: new FakeOutputChannel(),
    });
    let err;
    try {
      await server.start();
    } catch (caught) {
      err = caught;
    }
    (0, chai_1.expect)(err).to.be.instanceOf(Error);
    (0, chai_1.expect)(String(err)).to.include('No bearer tokens configured');
  });
});
//# sourceMappingURL=httpServer-auth.test.js.map
