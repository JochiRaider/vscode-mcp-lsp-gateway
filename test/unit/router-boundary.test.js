'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const node_events_1 = require('node:events');
const chai_1 = require('chai');
const router_1 = require('../../src/server/router');
const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const auth = {
  verifyAuthorizationHeader: (header) => header === 'Bearer good-token',
};
class MockRequest extends node_events_1.EventEmitter {
  method = 'POST';
  url = '/mcp';
  headers = {};
  destroy() {
    this.emit('close');
  }
}
class MockResponse {
  statusCode = 0;
  headersSent = false;
  writableEnded = false;
  headers = {};
  bodyText;
  resolveDone;
  done = new Promise((resolve) => {
    this.resolveDone = resolve;
  });
  setHeader(key, value) {
    this.headers[key.toLowerCase()] = value;
  }
  end(body) {
    this.headersSent = true;
    this.writableEnded = true;
    this.bodyText = body;
    this.resolveDone();
  }
}
async function invoke(listener, headers, body) {
  const req = new MockRequest();
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = new MockResponse();
  listener(req, res);
  if (body) req.emit('data', Buffer.from(body, 'utf8'));
  req.emit('end');
  await res.done;
  return { status: res.statusCode, headers: res.headers };
}
describe('router boundary', () => {
  it('rejects missing bearer token with 401', async () => {
    const listener = (0, router_1.createRouter)({
      endpointPath: '/mcp',
      maxRequestBytes: router_1.MAX_REQUEST_BYTES,
      allowedOrigins: [],
      auth,
      logger,
    });
    const res = await invoke(listener, {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    });
    (0, chai_1.expect)(res.status).to.equal(401);
    (0, chai_1.expect)(res.headers['www-authenticate']).to.equal('Bearer');
  });
  it('rejects disallowed Origin with 403', async () => {
    const listener = (0, router_1.createRouter)({
      endpointPath: '/mcp',
      maxRequestBytes: router_1.MAX_REQUEST_BYTES,
      allowedOrigins: ['https://allowed.example'],
      auth,
      logger,
    });
    const res = await invoke(listener, {
      Origin: 'https://blocked.example',
      Authorization: 'Bearer good-token',
    });
    (0, chai_1.expect)(res.status).to.equal(403);
  });
  it('passes only allowlisted headers to the handler', async () => {
    let seen;
    const onMcpPost = (ctx) => {
      seen = ctx.headers;
      return { status: 204 };
    };
    const listener = (0, router_1.createRouter)({
      endpointPath: '/mcp',
      maxRequestBytes: router_1.MAX_REQUEST_BYTES,
      allowedOrigins: [],
      auth,
      logger,
      onMcpPost,
    });
    const res = await invoke(
      listener,
      {
        Authorization: 'Bearer good-token',
        'MCP-Session-Id': 'session-123',
        'MCP-Protocol-Version': '2025-11-25',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      '{}',
    );
    (0, chai_1.expect)(res.status).to.equal(204);
    (0, chai_1.expect)(seen?.['authorization']).to.equal(undefined);
    (0, chai_1.expect)(seen?.['mcp-session-id']).to.equal('session-123');
    (0, chai_1.expect)(seen?.['mcp-protocol-version']).to.equal('2025-11-25');
  });
});
//# sourceMappingURL=router-boundary.test.js.map
