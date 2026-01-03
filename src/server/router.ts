import * as http from 'node:http';
import type { Logger } from '../logging/redact.js';
import { checkOrigin } from './origin.js';
import type { AuthVerifier } from './auth.js';

export const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MiB (hard cap)

export type McpPostContext = Readonly<{
  pathname: string;
  headers: Readonly<Record<string, string>>;
  bodyText: string;
  bodyBytes: number;
  requestId?: number;
}>;

export type McpPostResult = Readonly<{
  status: number;
  headers?: Readonly<Record<string, string>>;
  bodyText?: string;
}>;

export type McpPostHandler = (ctx: McpPostContext) => Promise<McpPostResult> | McpPostResult;

type RouterDeps = Readonly<{
  endpointPath: '/mcp';
  maxRequestBytes: number;
  allowedOrigins: readonly string[];
  auth: AuthVerifier;
  logger: Logger;
  onMcpPost?: McpPostHandler;
}>;

function headerValue(h: string | string[] | undefined): string | undefined {
  if (h === undefined) return undefined;
  return Array.isArray(h) ? h.join(',') : h;
}

const CONTEXT_HEADER_ALLOWLIST = new Set(['mcp-protocol-version', 'mcp-session-id']);

function sanitizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONTEXT_HEADER_ALLOWLIST) {
    const value = headerValue(headers[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function normalizeMediaType(v: string): string {
  const first = v.split(';')[0] ?? '';
  return first.trim().toLowerCase();
}

function acceptsRequired(acceptHeader: string | undefined): boolean {
  if (!acceptHeader) return false;
  const tokens = acceptHeader
    .split(',')
    .map((s) => normalizeMediaType(s))
    .filter((s) => s.length > 0);

  // Fail closed: must explicitly include BOTH tokens (no */* shortcut).
  return tokens.includes('application/json') && tokens.includes('text/event-stream');
}

function isApplicationJson(contentTypeHeader: string | undefined): boolean {
  if (!contentTypeHeader) return false;
  return normalizeMediaType(contentTypeHeader) === 'application/json';
}

function writeEmpty(
  res: http.ServerResponse,
  status: number,
  extraHeaders?: Record<string, string>,
): void {
  if (res.headersSent) return;
  res.statusCode = status;
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end();
}

export function createRouter(deps: RouterDeps): http.RequestListener {
  let nextRequestId = 1;
  return (req, res) => {
    const requestId = nextRequestId++;
    const startNs = process.hrtime.bigint();
    let requestLogged = false;
    let responseLogged = false;

    const durationMs = () => Number((process.hrtime.bigint() - startNs) / 1_000_000n);
    const logRequest = (meta: Record<string, unknown>) => {
      if (requestLogged) return;
      requestLogged = true;
      deps.logger.debug('http.request', meta);
    };
    const logResponse = (meta: Record<string, unknown>) => {
      if (responseLogged) return;
      responseLogged = true;
      deps.logger.debug('http.response', meta);
    };

    try {
      const method = (req.method ?? '').toUpperCase();
      const rawUrl = req.url ?? '';
      const pathname = rawUrl.split('?')[0] ?? '';
      const contentType = headerValue(req.headers['content-type']);
      const accept = headerValue(req.headers['accept']);
      const contentLengthHeader = headerValue(req.headers['content-length']);
      const contentLength = contentLengthHeader
        ? Number.parseInt(contentLengthHeader, 10)
        : undefined;

      logRequest({
        rid: requestId,
        method,
        path: pathname,
        contentType: contentType ? normalizeMediaType(contentType) : undefined,
        accept: summarizeAcceptHeader(accept),
        contentLength:
          typeof contentLength === 'number' && Number.isFinite(contentLength)
            ? contentLength
            : undefined,
        hasAuthorization: Boolean(headerValue(req.headers['authorization'])),
        hasSessionId: Boolean(headerValue(req.headers['mcp-session-id'])),
        hasProtocolVersion: Boolean(headerValue(req.headers['mcp-protocol-version'])),
        hasOrigin: Boolean(headerValue(req.headers['origin'])),
      });

      if (pathname !== deps.endpointPath) {
        logResponse({ rid: requestId, status: 404, durationMs: durationMs() });
        writeEmpty(res, 404);
        return;
      }
      if (method !== 'POST') {
        logResponse({ rid: requestId, status: 405, durationMs: durationMs() });
        writeEmpty(res, 405, { Allow: 'POST' });
        return;
      }

      // Origin allowlist enforcement (before reading body).
      const originResult = checkOrigin(req.headers, deps.allowedOrigins);
      if (!originResult.ok) {
        logResponse({ rid: requestId, status: 403, durationMs: durationMs() });
        writeEmpty(res, 403);
        return;
      }

      // Auth enforcement (before reading body).
      const authorization = headerValue(req.headers['authorization']);
      if (!deps.auth.verifyAuthorizationHeader(authorization)) {
        logResponse({ rid: requestId, status: 401, durationMs: durationMs() });
        writeEmpty(res, 401, { 'WWW-Authenticate': 'Bearer' });
        return;
      }

      // Content-Type and Accept requirements.
      if (!isApplicationJson(contentType)) {
        logResponse({ rid: requestId, status: 415, durationMs: durationMs() });
        writeEmpty(res, 415);
        return;
      }

      if (!acceptsRequired(accept)) {
        logResponse({ rid: requestId, status: 406, durationMs: durationMs() });
        writeEmpty(res, 406);
        return;
      }

      // Pre-check Content-Length if provided.
      if (contentLengthHeader) {
        if (
          typeof contentLength === 'number' &&
          Number.isFinite(contentLength) &&
          contentLength > deps.maxRequestBytes
        ) {
          logResponse({ rid: requestId, status: 413, durationMs: durationMs() });
          writeEmpty(res, 413);
          req.destroy();
          return;
        }
      }

      // Buffer request body up to cap.
      const chunks: Buffer[] = [];
      let total = 0;

      const onData = (chunk: Buffer) => {
        total += chunk.length;
        if (total > deps.maxRequestBytes) {
          deps.logger.debug('Payload exceeded limit; returning 413.', {
            total,
            max: deps.maxRequestBytes,
          });
          logResponse({ rid: requestId, status: 413, durationMs: durationMs() });
          writeEmpty(res, 413);
          req.off('data', onData);
          req.off('end', onEnd);
          req.destroy();
          return;
        }
        chunks.push(chunk);
      };

      const onEnd = () => {
        void (async () => {
          if (res.writableEnded) return;

          const bodyBytes = total;
          const bodyText = Buffer.concat(chunks, bodyBytes).toString('utf8');

          if (!deps.onMcpPost) {
            deps.logger.debug('No MCP handler configured; returning 500.');
            logResponse({ rid: requestId, status: 500, durationMs: durationMs() });
            writeEmpty(res, 500);
            return;
          }

          let result: McpPostResult;
          try {
            result = await deps.onMcpPost({
              pathname,
              headers: sanitizeHeaders(req.headers),
              bodyText,
              bodyBytes,
              requestId,
            });
          } catch (err) {
            // Fail closed: unexpected handler error => 500, empty body.
            // Keep logging bounded and avoid leaking payloads/secrets.
            deps.logger.debug('MCP handler threw; returning 500.', {
              error: err instanceof Error ? err.message : String(err),
            });
            logResponse({ rid: requestId, status: 500, durationMs: durationMs() });
            writeEmpty(res, 500);
            return;
          }

          if (result.headers) {
            for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v);
          }

          // Streamable HTTP: only JSON-RPC request responses carry bodies (200 + application/json).
          const shouldWriteBody = result.status === 200 && typeof result.bodyText === 'string';
          if (shouldWriteBody && !hasHeader(result.headers, 'content-type')) {
            res.setHeader('Content-Type', 'application/json');
          }

          res.statusCode = result.status;
          res.end(shouldWriteBody ? result.bodyText : undefined);
          logResponse({
            rid: requestId,
            status: result.status,
            durationMs: durationMs(),
            requestBytes: bodyBytes,
            responseBytes: shouldWriteBody ? Buffer.byteLength(result.bodyText ?? '', 'utf8') : 0,
          });
        })().catch(() => {
          logResponse({ rid: requestId, status: 500, durationMs: durationMs() });
          writeEmpty(res, 500);
        });
      };

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', () => {
        logResponse({ rid: requestId, status: 400, durationMs: durationMs() });
        writeEmpty(res, 400);
      });
    } catch {
      logResponse({ rid: requestId, status: 500, durationMs: durationMs() });
      writeEmpty(res, 500);
    }
  };
}

function hasHeader(
  headers: Readonly<Record<string, string>> | undefined,
  lowerName: string,
): boolean {
  if (!headers) return false;
  const target = lowerName.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === target) return true;
  }
  return false;
}

function summarizeAcceptHeader(
  acceptHeader: string | undefined,
): Record<string, boolean> | undefined {
  if (!acceptHeader) return undefined;
  const tokens = acceptHeader
    .split(',')
    .map((s) => normalizeMediaType(s))
    .filter((s) => s.length > 0);
  return {
    hasJson: tokens.includes('application/json'),
    hasEventStream: tokens.includes('text/event-stream'),
  };
}
