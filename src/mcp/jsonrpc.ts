// src/mcp/jsonrpc.ts
//
// Strict JSON-RPC 2.0 single-message parser/validator for MCP Streamable HTTP.
//
// Design goals:
// - Fail closed: reject anything that is not a single JSON object JSON-RPC message.
// - Reject batch arrays at the transport layer (caller should return HTTP 400, empty body).
// - Classify messages into: request, notification, response.
// - Validate only the minimal invariants required to route safely.

export type JsonRpcId = string | number;

export type JsonRpcErrorObject = Readonly<{
  code: number;
  message: string;
  data?: unknown;
}>;

export type JsonRpcRequest = Readonly<{
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}>;

export type JsonRpcNotification = Readonly<{
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}>;

export type JsonRpcResponse = Readonly<{
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}>;

export type ParsedJsonRpcMessage =
  | Readonly<{ kind: 'request'; msg: JsonRpcRequest }>
  | Readonly<{ kind: 'notification'; msg: JsonRpcNotification }>
  | Readonly<{ kind: 'response'; msg: JsonRpcResponse }>;

export type ParseJsonRpcMessageResult =
  | Readonly<{ ok: true; message: ParsedJsonRpcMessage }>
  | Readonly<{ ok: false; reason: 'invalid_json' | 'invalid_envelope' }>;

export function parseJsonRpcMessage(bodyText: string): ParseJsonRpcMessageResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  return validateJsonRpcMessage(parsed);
}

export function validateJsonRpcMessage(value: unknown): ParseJsonRpcMessageResult {
  if (!isRecord(value) || Array.isArray(value)) return { ok: false, reason: 'invalid_envelope' };

  if (value.jsonrpc !== '2.0') return { ok: false, reason: 'invalid_envelope' };

  const hasMethod = hasOwn(value, 'method');
  const hasResult = hasOwn(value, 'result');
  const hasError = hasOwn(value, 'error');
  const hasId = hasOwn(value, 'id');

  if (hasMethod && (hasResult || hasError)) return { ok: false, reason: 'invalid_envelope' };

  // Defensive: if method exists but isn't an own-property, still fail closed.
  if (!hasMethod && 'method' in value) return { ok: false, reason: 'invalid_envelope' };

  if (hasMethod) {
    const method = value.method;
    if (typeof method !== 'string' || method.trim().length === 0) {
      return { ok: false, reason: 'invalid_envelope' };
    }

    if (!hasId) {
      const msg: JsonRpcNotification = {
        jsonrpc: '2.0',
        method,
        ...(hasOwn(value, 'params') ? { params: value.params } : {}),
      };
      return { ok: true, message: { kind: 'notification', msg } };
    }

    const id = value.id;
    if (!isJsonRpcId(id)) return { ok: false, reason: 'invalid_envelope' };

    const msg: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(hasOwn(value, 'params') ? { params: value.params } : {}),
    };
    return { ok: true, message: { kind: 'request', msg } };
  }

  if (!hasId) return { ok: false, reason: 'invalid_envelope' };
  const id = value.id;
  if (!isJsonRpcId(id)) return { ok: false, reason: 'invalid_envelope' };

  const hasEither = (hasResult ? 1 : 0) + (hasError ? 1 : 0);
  if (hasEither !== 1) return { ok: false, reason: 'invalid_envelope' };

  if (hasError) {
    const err = value.error;
    if (!isJsonRpcErrorObject(err)) return { ok: false, reason: 'invalid_envelope' };
    const msg: JsonRpcResponse = { jsonrpc: '2.0', id, error: err };
    return { ok: true, message: { kind: 'response', msg } };
  }

  const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result: value.result };
  return { ok: true, message: { kind: 'response', msg } };
}

export function isJsonRpcId(v: unknown): v is JsonRpcId {
  if (typeof v === 'string') return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v);
  return false;
}

function isJsonRpcErrorObject(v: unknown): v is JsonRpcErrorObject {
  if (!isRecord(v) || Array.isArray(v)) return false;
  if (typeof v.code !== 'number' || !Number.isFinite(v.code)) return false;
  if (typeof v.message !== 'string' || v.message.trim().length === 0) return false;
  // data is optional and may be any JSON value.
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
