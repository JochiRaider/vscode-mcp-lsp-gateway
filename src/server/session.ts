import { randomBytes } from "node:crypto";

export type SessionState = {
  protocolVersion: "2025-11-25";
  createdAtMs: number;
  initializedNotificationSeen: boolean;
};

export type SessionRequireResult =
  | { ok: true; sessionId: string; session: SessionState }
  | { ok: false; status: 400 | 404 };

export type SessionStore = Readonly<{
  /** Mint a new session id and store its initial state. Returns the new id. */
  create: (protocolVersion: "2025-11-25") => string;
  /** Get a session state; undefined if unknown/evicted. */
  get: (sessionId: string) => SessionState | undefined;
  /**
   * Enforce the Streamable HTTP rules:
   * - missing session id => 400
   * - unknown/expired (evicted) => 404
   */
  require: (sessionId: string | undefined) => SessionRequireResult;
  /** Current number of active sessions. */
  size: () => number;
}>;

export type CreateSessionStoreOptions = Readonly<{
  /**
   * Hard cap on concurrently tracked sessions.
   * When exceeded, evict the oldest (in insertion order).
   *
   * Deterministic with respect to request sequence (no TTL by default).
   */
  maxSessions?: number;
  /** Injectable clock for tests/diagnostics; default is Date.now. */
  nowMs?: () => number;
}>;

export function mint(): string {
  // 16 bytes is sufficient; base64url is header-safe ASCII.
  return randomBytes(16).toString("base64url");
}

export function createSessionStore(opts: CreateSessionStoreOptions = {}): SessionStore {
  const maxSessions = clampInt(opts.maxSessions ?? 64, 1, 1024);
  const nowMs = opts.nowMs ?? (() => Date.now());

  // Map iteration order is insertion order; used for deterministic eviction.
  const sessions = new Map<string, SessionState>();

  const evictIfNeeded = () => {
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value;
      if (typeof oldest !== "string") break;
      sessions.delete(oldest);
    }
  };

  return {
    create: (protocolVersion) => {
      const id = mint();
      sessions.set(id, {
        protocolVersion,
        createdAtMs: nowMs(),
        initializedNotificationSeen: false,
      });
      evictIfNeeded();
      return id;
    },
    get: (sessionId) => sessions.get(sessionId),
    require: (sessionId) => {
      if (!sessionId) return { ok: false, status: 400 };
      const session = sessions.get(sessionId);
      if (!session) return { ok: false, status: 404 };
      return { ok: true, sessionId, session };
    },
    size: () => sessions.size,
  };
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const x = Math.trunc(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}