import { EventEmitter } from 'node:events';
import type * as http from 'node:http';
import { expect } from 'chai';
import { createRouter, MAX_REQUEST_BYTES, type McpPostHandler } from '../../src/server/router.js';
import type { AuthVerifier } from '../../src/server/auth.js';
import type { Logger } from '../../src/logging/redact.js';

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const auth = {
  verifyAuthorizationHeader: (header: string | undefined) => header === 'Bearer good-token',
} as unknown as AuthVerifier;

class MockRequest extends EventEmitter {
  public method = 'POST';
  public url = '/mcp';
  public headers: http.IncomingHttpHeaders = {};

  public destroy(): void {
    this.emit('close');
  }
}

class MockResponse {
  public statusCode = 0;
  public headersSent = false;
  public writableEnded = false;
  public headers: Record<string, string> = {};
  public bodyText: string | undefined;

  private resolveDone!: () => void;
  public done = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });

  public setHeader(key: string, value: string): void {
    this.headers[key.toLowerCase()] = value;
  }

  public end(body?: string): void {
    this.headersSent = true;
    this.writableEnded = true;
    this.bodyText = body;
    this.resolveDone();
  }
}

async function invoke(
  listener: http.RequestListener,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  const req = new MockRequest();
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = new MockResponse();

  listener(req as unknown as http.IncomingMessage, res as unknown as http.ServerResponse);

  if (body) req.emit('data', Buffer.from(body, 'utf8'));
  req.emit('end');

  await res.done;
  return { status: res.statusCode, headers: res.headers };
}

describe('router boundary', () => {
  it('rejects missing bearer token with 401', async () => {
    const listener = createRouter({
      endpointPath: '/mcp',
      maxRequestBytes: MAX_REQUEST_BYTES,
      allowedOrigins: [],
      auth,
      logger,
    });

    const res = await invoke(listener, {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    });
    expect(res.status).to.equal(401);
    expect(res.headers['www-authenticate']).to.equal('Bearer');
  });

  it('rejects disallowed Origin with 403', async () => {
    const listener = createRouter({
      endpointPath: '/mcp',
      maxRequestBytes: MAX_REQUEST_BYTES,
      allowedOrigins: ['https://allowed.example'],
      auth,
      logger,
    });

    const res = await invoke(listener, {
      Origin: 'https://blocked.example',
      Authorization: 'Bearer good-token',
    });
    expect(res.status).to.equal(403);
  });

  it('passes only allowlisted headers to the handler', async () => {
    let seen: Record<string, string> | undefined;
    const onMcpPost: McpPostHandler = (ctx) => {
      seen = ctx.headers;
      return { status: 204 };
    };

    const listener = createRouter({
      endpointPath: '/mcp',
      maxRequestBytes: MAX_REQUEST_BYTES,
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
    expect(res.status).to.equal(204);
    expect(seen?.['authorization']).to.equal(undefined);
    expect(seen?.['mcp-session-id']).to.equal('session-123');
    expect(seen?.['mcp-protocol-version']).to.equal('2025-11-25');
  });
});
