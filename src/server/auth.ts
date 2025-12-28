import { createHash, timingSafeEqual } from 'node:crypto';
import type * as vscode from 'vscode';

export const MAX_BEARER_TOKENS = 32;

/**
 * AuthVerifier loads bearer tokens from VS Code SecretStorage and verifies
 * incoming Authorization headers using constant-time comparison.
 *
 * Storage format (SecretStorage):
 *   JSON array of strings, e.g. ["tokenA","tokenB"]
 *
 * Security notes:
 * - Never log tokens.
 * - We compare fixed-length SHA-256 digests via timingSafeEqual.
 * - Verification loops across all configured tokens (no early-exit).
 */
export class AuthVerifier {
  private constructor(private readonly tokenDigests: readonly Buffer[]) {}

  public static async createFromSecretStorage(
    secrets: vscode.SecretStorage,
    secretKey: string,
  ): Promise<AuthVerifier> {
    const raw = await secrets.get(secretKey);
    if (!raw) return new AuthVerifier([]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed secret -> treat as no valid tokens (fail closed: always 401).
      return new AuthVerifier([]);
    }

    if (!Array.isArray(parsed)) return new AuthVerifier([]);

    const tokens = parsed
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Deterministic dedupe + bound count.
    const deduped = Array.from(new Set(tokens)).slice(0, MAX_BEARER_TOKENS);

    const digests = deduped.map((t) => sha256(t));
    return new AuthVerifier(digests);
  }

  /** Returns true iff the Authorization header is a valid Bearer token. */
  public verifyAuthorizationHeader(authorizationHeader: string | undefined): boolean {
    const token = extractBearerToken(authorizationHeader);
    if (!token) return false;

    const candidate = sha256(token);

    // Constant-time across all configured tokens: no early return.
    let match = 0;
    for (const d of this.tokenDigests) {
      // Both are fixed-length 32 bytes.
      const eq = timingSafeEqual(d, candidate) ? 1 : 0;
      match |= eq;
    }
    return match === 1;
  }

  public getTokenCount(): number {
    return this.tokenDigests.length;
  }
}

export function extractBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  // RFC 6750 style: "Bearer <token>"
  const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(authorizationHeader);
  if (!m) return undefined;
  const token = m[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}
