// src/tools/paging/cursor.ts
//
// Canonical cursor + paging helpers for v1 paged tools (CONTRACT §3.6).

import { createHash } from 'node:crypto';
import type { JsonRpcErrorObject } from '../../mcp/jsonrpc.js';

export const CURSOR_VERSION = 1 as const;
export const ERROR_CODE_CURSOR_INVALID = 'MCP_LSP_GATEWAY/CURSOR_INVALID' as const;

export type CursorPayload = Readonly<{ v: 1; o: number; k: string }>;

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
  const prefix = ['v1', toolName];
  const keyInput = prefix.concat(parts.map((part) => String(part))).join('|');
  return sha256hex(keyInput);
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify({ v: payload.v, o: payload.o, k: payload.k });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== CURSOR_VERSION) return null;
    if (typeof rec.o !== 'number' || !Number.isInteger(rec.o) || rec.o < 0) return null;
    if (typeof rec.k !== 'string' || rec.k.length === 0) return null;
    return { v: CURSOR_VERSION, o: rec.o, k: rec.k };
  } catch {
    return null;
  }
}

export function validateCursor(
  raw: string | null | undefined,
  requestKey: string,
): CursorValidationResult {
  if (raw === null || raw === undefined) return { ok: true, offset: 0 };
  if (typeof raw !== 'string') return { ok: false, error: cursorInvalidError() };

  const parsed = decodeCursor(raw);
  if (!parsed) return { ok: false, error: cursorInvalidError() };
  if (parsed.k !== requestKey) return { ok: false, error: cursorInvalidError() };

  return { ok: true, offset: parsed.o };
}

export function paginate<T>(
  full: readonly T[],
  pageSize: number,
  cursor: string | null | undefined,
  requestKey: string,
): PageResult<T> {
  const validated = validateCursor(cursor, requestKey);
  if (!validated.ok) return { ok: false, error: validated.error };

  const safePageSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : 1;
  const offset = validated.offset;
  const items = full.slice(offset, offset + safePageSize);
  const nextOffset = offset + safePageSize;
  const nextCursor =
    nextOffset >= full.length ? null : encodeCursor({ v: CURSOR_VERSION, o: nextOffset, k: requestKey });
  return { ok: true, items, nextCursor, offset };
}

function cursorInvalidError(): JsonRpcErrorObject {
  return {
    code: -32602,
    message: 'Invalid params',
    data: { code: ERROR_CODE_CURSOR_INVALID },
  };
}

function sha256hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
