import * as http from 'node:http';

export type OriginCheckResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: 'ORIGIN_NOT_ALLOWED' }>;

function headerValue(h: string | string[] | undefined): string | undefined {
  if (h === undefined) return undefined;
  return Array.isArray(h) ? h.join(',') : h;
}

/**
 * Origin allowlist enforcement (fail closed when Origin is present):
 * - If Origin header is absent: allow.
 * - If Origin header is present: MUST exactly match one entry in allowlist; else 403.
 *
 * Note: "exact match" means no normalization and no wildcard support.
 */
export function checkOrigin(
  headers: http.IncomingHttpHeaders,
  allowlist: readonly string[],
): OriginCheckResult {
  const origin = headerValue(headers['origin']);
  if (!origin) return { ok: true };

  // Exact match only.
  const allowed = allowlist.includes(origin);
  return allowed ? { ok: true } : { ok: false, reason: 'ORIGIN_NOT_ALLOWED' };
}
