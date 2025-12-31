import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

export type TokenSecretParseResult =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'valid'; tokens: string[] };

export function parseTokenSecret(raw: string | undefined): TokenSecretParseResult {
  if (raw === undefined) return { kind: 'missing' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid' };
  }

  if (!Array.isArray(parsed)) return { kind: 'invalid' };

  const tokens: string[] = [];
  for (const v of parsed) {
    if (typeof v !== 'string') return { kind: 'invalid' };
    const token = v.trim();
    if (token.length > 0) tokens.push(token);
  }

  return { kind: 'valid', tokens };
}

export function generateBearerToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function ensureBearerTokenPresent(
  secrets: vscode.SecretStorage,
  secretKey: string,
): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  const raw = await secrets.get(secretKey);
  const parsed = parseTokenSecret(raw);

  if (parsed.kind === 'invalid') {
    return {
      ok: false,
      reason: 'Bearer token SecretStorage value is malformed.',
    };
  }

  if (parsed.kind === 'missing' || parsed.tokens.length === 0) {
    const token = generateBearerToken();
    await secrets.store(secretKey, JSON.stringify([token]));
    return { ok: true, created: true };
  }

  return { ok: true, created: false };
}
