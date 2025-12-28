import * as http from "node:http";
import type * as vscode from "vscode";

export const DEFAULT_LOG_MAX_CHARS = 2048;

export type Logger = Readonly<{
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}>;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "x-api-key",
  "mcp-session-id",
]);

export function createLogger(
  output: vscode.OutputChannel,
  opts: Readonly<{ debugEnabled: boolean; maxChars?: number }>,
): Logger {
  const maxChars = opts.maxChars ?? DEFAULT_LOG_MAX_CHARS;

  const emit = (level: "debug" | "info" | "warn" | "error", msg: string, meta?: unknown) => {
    if (level === "debug" && !opts.debugEnabled) return;

    const safeMsg = bound(redactString(msg), maxChars);
    const safeMeta =
      meta === undefined ? "" : " " + bound(redactString(safeJson(meta)), Math.max(0, maxChars - safeMsg.length));

    output.appendLine(`[${level}] ${safeMsg}${safeMeta}`.slice(0, maxChars));
  };

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
  };
}

export function redactHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kRaw, v] of Object.entries(headers)) {
    const k = kRaw.toLowerCase();
    if (isSensitiveHeaderKey(k)) {
      out[kRaw] = "[REDACTED]";
      continue;
    }
    if (v === undefined) continue;
    out[kRaw] = Array.isArray(v) ? v.join(",") : String(v);
  }
  return out;
}

/**
 * Best-effort redaction for strings that might accidentally contain secrets.
 * This is a guardrail; do not rely on it as the primary control.
 */
export function redactString(s: string): string {
  // Redact bearer tokens.
  let x = s.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  // Redact common MCP session header occurrences if someone logs headers naively.
  x = x.replace(/(\bMCP-Session-Id\b\s*:\s*)[^\s,]+/gi, "$1[REDACTED]");
  x = x.replace(/(\bMCP-Protocol-Version\b\s*:\s*)[^\s,]+/gi, "$1[REDACTED]");
  return x;
}

function bound(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, Math.max(0, maxChars - 12)) + "…[truncated]";
}

function safeJson(meta: unknown): string {
  try {
    return JSON.stringify(meta, (k: string, v: unknown): unknown => {
      if (k && isSensitiveHeaderKey(k.toLowerCase())) return "[REDACTED]";
      if (typeof v === "string") return redactString(v);
      return v;
    });
  } catch {
    return "[unserializable]";
  }
}

function isSensitiveHeaderKey(key: string): boolean {
  return SENSITIVE_HEADERS.has(key);
}
