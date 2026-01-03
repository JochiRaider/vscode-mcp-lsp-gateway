import type { ParsedJsonRpcMessage } from '../mcp/jsonrpc.js';
import { redactString } from './redact.js';

export type TraceSanitizeOptions = Readonly<{
  maxDepth: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  maxStringChars: number;
}>;

const DEFAULTS: TraceSanitizeOptions = {
  maxDepth: 6,
  maxArrayItems: 20,
  maxObjectKeys: 40,
  maxStringChars: 160,
};

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key',
  'mcp-session-id',
  'mcp-protocol-version',
]);

const TEXT_KEY_HINTS = new Set([
  'text',
  'message',
  'detail',
  'contents',
  'content',
  'summary',
  'documentation',
]);

export function sanitizeJsonRpcMessage(
  message: ParsedJsonRpcMessage,
  overrides?: Partial<TraceSanitizeOptions>,
): Record<string, unknown> {
  const opts = resolveOptions(overrides);
  switch (message.kind) {
    case 'request':
      return {
        kind: 'request',
        id: message.msg.id,
        method: message.msg.method,
        ...(message.msg.params !== undefined
          ? { params: sanitizeForTrace(message.msg.params, opts) }
          : {}),
      };
    case 'notification':
      return {
        kind: 'notification',
        method: message.msg.method,
        ...(message.msg.params !== undefined
          ? { params: sanitizeForTrace(message.msg.params, opts) }
          : {}),
      };
    case 'response':
      return {
        kind: 'response',
        id: message.msg.id,
        ...(message.msg.error !== undefined
          ? { error: sanitizeForTrace(message.msg.error, opts) }
          : { result: sanitizeForTrace(message.msg.result, opts) }),
      };
  }
}

export function sanitizeForTrace(
  value: unknown,
  overrides?: Partial<TraceSanitizeOptions>,
): unknown {
  const opts = resolveOptions(overrides);
  return sanitizeValue(value, opts, 0, undefined, new WeakSet());
}

function resolveOptions(overrides?: Partial<TraceSanitizeOptions>): TraceSanitizeOptions {
  return {
    maxDepth: overrides?.maxDepth ?? DEFAULTS.maxDepth,
    maxArrayItems: overrides?.maxArrayItems ?? DEFAULTS.maxArrayItems,
    maxObjectKeys: overrides?.maxObjectKeys ?? DEFAULTS.maxObjectKeys,
    maxStringChars: overrides?.maxStringChars ?? DEFAULTS.maxStringChars,
  };
}

function sanitizeValue(
  value: unknown,
  opts: TraceSanitizeOptions,
  depth: number,
  keyHint: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (depth > opts.maxDepth) return '[max-depth]';
  if (value === null) return null;
  if (typeof value === 'string') return sanitizeString(value, opts, keyHint);
  const valueType = typeof value;
  if (valueType === 'number' || valueType === 'boolean') return value;
  if (Array.isArray(value)) return sanitizeArray(value, opts, depth, seen);
  if (valueType !== 'object') return `[${valueType}]`;

  const obj = value as Record<string, unknown>;
  if (seen.has(obj)) return '[circular]';
  seen.add(obj);

  const keys = Object.keys(obj).sort();
  const limited = keys.slice(0, opts.maxObjectKeys);
  const out: Record<string, unknown> = {};
  for (const key of limited) {
    const lower = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lower)) {
      out[key] = '[REDACTED]';
      continue;
    }
    out[key] = sanitizeValue(obj[key], opts, depth + 1, lower, seen);
  }
  if (keys.length > limited.length) {
    out._truncatedKeys = keys.length - limited.length;
  }
  return out;
}

function sanitizeArray(
  value: unknown[],
  opts: TraceSanitizeOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown[] {
  const limited = value.slice(0, opts.maxArrayItems);
  const out = limited.map((item) => sanitizeValue(item, opts, depth + 1, undefined, seen));
  if (value.length > limited.length) {
    out.push(`[truncated ${value.length - limited.length} items]`);
  }
  return out;
}

function sanitizeString(
  value: string,
  opts: TraceSanitizeOptions,
  keyHint: string | undefined,
): unknown {
  if (keyHint && TEXT_KEY_HINTS.has(keyHint)) {
    return { len: value.length };
  }
  let out = redactPathLike(redactString(value));
  if (out.length > opts.maxStringChars) {
    out = `${out.slice(0, opts.maxStringChars)}...[truncated]`;
  }
  return out;
}

function redactPathLike(value: string): string {
  return value
    .replace(/file:\/\/\/[^\s)]+/g, 'file:///[REDACTED_PATH]')
    .replace(/(^|[\s(])\/[^\s)]+/g, '$1[REDACTED_PATH]')
    .replace(/(^|[\s(])[A-Za-z]:\\[^\s)]+/g, '$1[REDACTED_PATH]')
    .replace(/(^|[\s(])\\\\[^\s)]+/g, '$1[REDACTED_PATH]');
}
