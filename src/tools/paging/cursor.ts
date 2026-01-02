// src/tools/paging/cursor.ts
//
// Canonical cursor + paging helpers for v1 paged tools (CONTRACT §3.6).

import { createHash } from 'node:crypto';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';
import { stableJsonStringify } from '../../util/stableStringify.js';

export const CURSOR_VERSION = 2 as const;
export const ERROR_CODE_CURSOR_INVALID = 'MCP_LSP_GATEWAY/CURSOR_INVALID' as const;
export const ERROR_CODE_CURSOR_STALE = 'MCP_LSP_GATEWAY/CURSOR_STALE' as const;
export const ERROR_CODE_CURSOR_EXPIRED = 'MCP_LSP_GATEWAY/CURSOR_EXPIRED' as const;
export const ERROR_CODE_SNAPSHOT_TOO_LARGE = 'MCP_LSP_GATEWAY/SNAPSHOT_TOO_LARGE' as const;

export type CursorPayload = Readonly<{ v: 2; o: number; k: string; s: string }>;

export type CursorValidationResult =
  | Readonly<{ ok: true; offset: number }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export type PageResult<T> =
  | Readonly<{ ok: true; items: readonly T[]; nextCursor: string | null; offset: number }>
  | Readonly<{ ok: false; error: JsonRpcErrorObject }>;

export function computeRequestKey(
  toolName: string,
  parts: readonly (string | number | boolean)[],
): string {
  const keyInput = stableJsonStringify(['v1', toolName, ...parts]);
  return sha256hex(keyInput);
}

export function formatEpochTupleString(rootsKey: string, epochs: readonly number[]): string {
  const epochParts = epochs.map((epoch) => String(epoch));
  return `roots:${rootsKey}|epochs:${epochParts.join(',')}`;
}

export function computeSnapshotKey(requestKey: string, epochTupleString: string): string {
  const keyInput = ['v1', 'snapshot', requestKey, epochTupleString].join('|');
  return sha256hex(keyInput);
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ v: payload.v, o: payload.o, k: payload.k, s: payload.s });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== CURSOR_VERSION) return null;
    if (typeof rec.o !== 'number' || !Number.isInteger(rec.o) || rec.o < 0) return null;
    if (typeof rec.k !== 'string' || rec.k.length === 0) return null;
    if (typeof rec.s !== 'string' || rec.s.length === 0) return null;
    return { v: CURSOR_VERSION, o: rec.o, k: rec.k, s: rec.s };
  } catch {
    return null;
  }
}

export function validateCursor(
  raw: string | null | undefined,
  requestKey: string,
  snapshotKey: string,
): CursorValidationResult {
  if (raw === null || raw === undefined) return { ok: true, offset: 0 };
  if (typeof raw !== 'string') return { ok: false, error: cursorInvalidError() };

  const parsed = decodeCursor(raw);
  if (!parsed) return { ok: false, error: cursorInvalidError() };
  if (parsed.k !== requestKey) return { ok: false, error: cursorInvalidError() };
  if (parsed.s !== snapshotKey) return { ok: false, error: cursorStaleError() };

  return { ok: true, offset: parsed.o };
}

export function paginate<T>(
  full: readonly T[],
  pageSize: number,
  cursor: string | null | undefined,
  requestKey: string,
  snapshotKey: string,
): PageResult<T> {
  const validated = validateCursor(cursor, requestKey, snapshotKey);
  if (!validated.ok) return { ok: false, error: validated.error };

  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1;
  const offset = validated.offset;
  const items = full.slice(offset, offset + safePageSize);
  const nextOffset = offset + safePageSize;
  const nextCursor =
    nextOffset >= full.length
      ? null
      : encodeCursor({ v: CURSOR_VERSION, o: nextOffset, k: requestKey, s: snapshotKey });
  return { ok: true, items, nextCursor, offset };
}

function cursorInvalidError(): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code: ERROR_CODE_CURSOR_INVALID },
  };
}

function cursorStaleError(): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code: ERROR_CODE_CURSOR_STALE },
  };
}

export function cursorExpiredError(): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code: ERROR_CODE_CURSOR_EXPIRED },
  };
}

export function snapshotTooLargeError(): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code: ERROR_CODE_SNAPSHOT_TOO_LARGE },
  };
}

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
