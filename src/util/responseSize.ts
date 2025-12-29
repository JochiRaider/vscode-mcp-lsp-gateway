// src/util/responseSize.ts
//
// UTF-8 byte size helpers for deterministic payload enforcement.

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}
