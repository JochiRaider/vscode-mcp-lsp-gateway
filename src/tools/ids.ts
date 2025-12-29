// src/tools/ids.ts
//
// Stable identifier helper for v1 tool outputs (CONTRACT §3.7).

import { createHash } from 'node:crypto';

export function stableIdFromCanonicalString(canonicalString: string): string {
  const digest = createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  return `sha256:${digest}`;
}
