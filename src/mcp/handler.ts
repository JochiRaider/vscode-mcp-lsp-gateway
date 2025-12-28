// src/mcp/handler.ts
//
// Minimal MCP JSON-RPC handler for Streamable HTTP (v1):
// - Strict JSON-RPC envelope validation (delegated to ./jsonrpc)
// - Lifecycle: initialize -> notifications/initialized
// - Post-init header enforcement: MCP-Protocol-Version (+ MCP-Session-Id when sessions enabled)
// - Routing: ping + tools/list + tools/call (delegated to tools/dispatcher)
//
// Notes:
// - Transport/security gating (Content-Type, Accept, Authorization, Origin, max bytes) should already
//   be enforced before this handler is invoked.
// - All HTTP-layer rejections return empty bodies (fail-closed), even for JSON-RPC requests with ids.

import { createSessionStore, type SessionStore } from "../server/session.js";
import type { McpPostContext, McpPostHandler, McpPostResult } from "../server/router.js";
import {
  parseJsonRpcMessage,
  type JsonRpcId,
  type JsonRpcErrorObject,
} from "./jsonrpc.js";
import { dispatchToolsList, dispatchToolCall } from "../tools/dispatcher.js";
import type { SchemaRegistry } from "../tools/schemaRegistry.js";

export type McpServerInfo = Readonly<{
  name: string;
  version: string;
}>;

export type CreateMcpPostHandlerOptions = Readonly<{
  protocolVersion: "2025-11-25";
  serverInfo: McpServerInfo;
  enableSessions: boolean;
  schemaRegistry: SchemaRegistry;
  maxItemsPerPage: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  /**
   * Canonical realpaths of allowlisted roots (workspace folders + additional roots).
   */
  allowedRootsRealpaths: readonly string[];
  /**
   * Interop escape hatch:
   * If (and only if) you reproduce a client that omits MCP-Protocol-Version on notifications/initialized,
   * you may allow that one request to pass without the header.
   *
   * Default: false (fail closed).
   */
  allowMissingProtocolVersionOnInitializedNotification?: boolean;
}>;

type InitializeResult = Readonly<{
  protocolVersion: "2025-11-25";
  capabilities: Readonly<{
    tools: Readonly<{
      listChanged: false;
    }>;
  }>;
  serverInfo: McpServerInfo;
}>;

const ERR_CURSOR_INVALID = "MCP_LSP_GATEWAY/CURSOR_INVALID" as const;
const ERR_CAP_EXCEEDED = "MCP_LSP_GATEWAY/CAP_EXCEEDED" as const;
const ERR_INVALID_PARAMS = "MCP_LSP_GATEWAY/INVALID_PARAMS" as const;

export function createMcpPostHandler(opts: CreateMcpPostHandlerOptions): McpPostHandler {
  // Global init state (used when sessions are disabled).
  let didAnyInitializeSucceed = false;
  let didReceiveInitializedNotification = false;

  // Session state (used when sessions are enabled).
  // NOTE: Session IDs are intentionally nondeterministic; enforcement behavior is deterministic.
  const sessionStore: SessionStore | undefined = opts.enableSessions
    ? createSessionStore({
        // Deterministic eviction by insertion order; no TTL by default.
        maxSessions: 64,
      })
    : undefined;

  return async function onMcpPost(ctx: McpPostContext): Promise<McpPostResult> {
    const bodyText = ctx.bodyText;

    const parsed = parseJsonRpcMessage(bodyText);
    if (!parsed.ok) {
      // Invalid JSON or invalid JSON-RPC envelope: transport-layer 400, empty body.
      return { status: 400 };
    }

    // JSON-RPC responses sent to us are accepted and ignored.
    if (parsed.message.kind === "response") {
      return { status: 202 };
    }

    const headers = ctx.headers;
    const method = parsed.message.msg.method;

    // Lifecycle / post-init model:
    // - Pre-init: only "initialize" should succeed.
    // - Post-init: enforce MCP-Protocol-Version (and session id if enabled) on every request/notification.
    const postInit = opts.enableSessions ? (sessionStore?.size() ?? 0) > 0 : didAnyInitializeSucceed;

    // Helper: enforce post-init headers (HTTP errors, empty body).
    const enforcePostInitHeaders = (
      requireProtocolVersion: boolean,
      requireSession: boolean,
      allowMissingProtocolVersionForThisCall: boolean,
    ): { ok: true; sessionId?: string } | { ok: false; status: number } => {
      if (requireProtocolVersion) {
        const pv = getHeader(headers, "mcp-protocol-version");
        if (!pv) {
          if (!allowMissingProtocolVersionForThisCall) return { ok: false, status: 400 };
        } else if (pv !== opts.protocolVersion) {
          return { ok: false, status: 400 };
        }
      }

      if (requireSession) {
        if (!sessionStore) return { ok: false, status: 500 };
        const sid = getHeader(headers, "mcp-session-id");
        const r = sessionStore.require(sid);
        if (!r.ok) return { ok: false, status: r.status };
        return { ok: true, sessionId: r.sessionId };
      }

      return { ok: true };
    };

    // --- initialize ---------------------------------------------------------
    if (method === "initialize") {
      if (parsed.message.kind !== "request") {
        // initialize MUST be a request; as a notification we cannot respond with JSON-RPC.
        return { status: 400 };
      }

      const req = parsed.message.msg;

      // Validate required param: params.protocolVersion must match.
      const pv = getProtocolVersionParam(req.params);
      if (pv !== opts.protocolVersion) {
        return jsonRpcErrorResponse(req.id, {
          code: -32602,
          message: "Invalid params",
          data: {
            expected: opts.protocolVersion,
            got: pv ?? null,
          },
        });
      }

      // Success path:
      didAnyInitializeSucceed = true;

      const result: InitializeResult = {
        protocolVersion: opts.protocolVersion,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: opts.serverInfo,
      };

      if (opts.enableSessions) {
        // Mint and attach MCP-Session-Id header.
        const sessionId = sessionStore!.create(opts.protocolVersion);
        return jsonRpcResultResponse(req.id, result, { "MCP-Session-Id": sessionId });
      }

      return jsonRpcResultResponse(req.id, result);
    }

    // --- notifications/initialized ----------------------------------------
    if (method === "notifications/initialized") {
      // Post-init requirement: this MUST happen after initialize.
      // Fail closed at transport layer (HTTP 400) if we have never initialized.
      if (!postInit) return { status: 400 };

      // Enforce post-init headers on this subsequent request.
      const allowMissingPv =
        Boolean(opts.allowMissingProtocolVersionOnInitializedNotification) &&
        parsed.message.kind === "notification";

      const hdr = enforcePostInitHeaders(
        /* requireProtocolVersion */ true,
        /* requireSession */ opts.enableSessions,
        /* allowMissingProtocolVersionForThisCall */ allowMissingPv,
      );
      if (!hdr.ok) return { status: hdr.status };

      if (opts.enableSessions) {
        const sid = hdr.sessionId!;
        const st = sessionStore!.get(sid);
        if (st) st.initializedNotificationSeen = true;
      } else {
        didReceiveInitializedNotification = true;
      }

      // Spec: notifications return 202 with no body.
      return { status: 202 };
    }

    // --- Other notifications ----------------------------------------------
    if (parsed.message.kind === "notification") {
      // Pre-init: only initialize should succeed. Notifications cannot carry JSON-RPC errors.
      if (!postInit) return { status: 400 };

      // Post-init: enforce MCP headers for all subsequent notifications.
      if (postInit) {
        const hdr = enforcePostInitHeaders(
          /* requireProtocolVersion */ true,
          /* requireSession */ opts.enableSessions,
          /* allowMissingProtocolVersionForThisCall */ false,
        );
        if (!hdr.ok) return { status: hdr.status };
      }
      return { status: 202 };
    }

    // From here: requests (must receive JSON-RPC response, unless HTTP-layer rejection applies).
    const req = parsed.message.msg;

    // Lifecycle: require initialization before serving any non-initialize requests.
    // This is a JSON-RPC-level error (not a transport-level error) because the envelope is valid.
    if (!postInit) {
      return jsonRpcErrorResponse(req.id, { code: -32600, message: "Not initialized" });
    }

    // Enforce post-init headers (HTTP-layer errors, empty body).
    const hdr = enforcePostInitHeaders(
      /* requireProtocolVersion */ true,
      /* requireSession */ opts.enableSessions,
      /* allowMissingProtocolVersionForThisCall */ false,
    );
    if (!hdr.ok) return { status: hdr.status };

    // Optional stricter lifecycle: require notifications/initialized before non-health methods.
    // We allow "ping" regardless once initialize succeeded.
    if (method !== "ping") {
      if (opts.enableSessions) {
        const sid = hdr.sessionId!;
        const st = sessionStore!.get(sid);
        if (!st?.initializedNotificationSeen) {
          return jsonRpcErrorResponse(req.id, {
            code: -32600,
            message: "Not initialized",
            data: { detail: "notifications/initialized not received" },
          });
        }
      } else if (!didReceiveInitializedNotification) {
        return jsonRpcErrorResponse(req.id, {
          code: -32600,
          message: "Not initialized",
          data: { detail: "notifications/initialized not received" },
        });
      }
    }

    // --- ping --------------------------------------------------------------
    if (method === "ping") {
      // Keep result deterministic and minimal.
      return jsonRpcResultResponse(req.id, {});
    }

    // --- tools/list --------------------------------------------------------
    if (method === "tools/list") {
      // Params: { cursor?: string | null }
      const cursorParsed = parseOptionalCursor(req.params);
      if (!cursorParsed.ok) {
        return jsonRpcErrorResponse(req.id, {
          code: -32602,
          message: "Invalid params",
          data: { code: ERR_INVALID_PARAMS },
        });
      }
      if (cursorParsed.cursor !== null) {
        // Fail closed: no pagination for tools/list in v1.
        return jsonRpcErrorResponse(req.id, {
          code: -32602,
          message: "Invalid params",
          data: { code: ERR_CURSOR_INVALID },
        });
      }

      // MCP semantics: { tools: [...], nextCursor?: undefined }
      return jsonRpcResultResponse(req.id, dispatchToolsList(opts.schemaRegistry));
    }

    // --- tools/call --------------------------------------------------------
    if (method === "tools/call") {
      const parsedCall = parseToolsCallParams(req.params);
      if (!parsedCall.ok) {
        return jsonRpcErrorResponse(req.id, {
          code: -32602,
          message: "Invalid params",
          data: { code: ERR_INVALID_PARAMS },
        });
      }

      const toolName = parsedCall.name;
      const args = parsedCall.arguments;

      const dispatched = await dispatchToolCall(toolName, args, {
        schemaRegistry: opts.schemaRegistry,
        allowedRootsRealpaths: opts.allowedRootsRealpaths,
        maxItemsPerPage: opts.maxItemsPerPage,
        requestTimeoutMs: opts.requestTimeoutMs,
      });

      if (!dispatched.ok) return jsonRpcErrorResponse(req.id, dispatched.error);
      const response = jsonRpcResultResponse(req.id, dispatched.result);
      if (response.bodyText && exceedsMaxResponseBytes(response.bodyText, opts.maxResponseBytes)) {
        return jsonRpcErrorResponse(req.id, capExceededError("Response exceeded maxResponseBytes."));
      }
      return response;
    }

    // Default: method not found.
    return jsonRpcErrorResponse(req.id, { code: -32601, message: "Method not found" });
  };
}

function jsonRpcResultResponse(
  id: JsonRpcId,
  result: unknown,
  headers?: Readonly<Record<string, string>>,
): McpPostResult {
  const bodyText = JSON.stringify({ jsonrpc: "2.0", id, result });
  const response: McpPostResult = {
    status: 200,
    ...(headers ? { headers } : {}),
    bodyText,
  };
  return response;
}

function jsonRpcErrorResponse(id: JsonRpcId, error: JsonRpcErrorObject): McpPostResult {
  const bodyText = JSON.stringify({ jsonrpc: "2.0", id, error });
  return {
    status: 200,
    bodyText,
  };
}

function capExceededError(message: string): JsonRpcErrorObject {
  const data: Record<string, unknown> = { code: ERR_CAP_EXCEEDED };
  const trimmed = message.trim();
  if (trimmed.length > 0) data.message = trimmed;
  return {
    code: -32603,
    message: "Internal error",
    data,
  };
}

function exceedsMaxResponseBytes(bodyText: string, maxResponseBytes: number): boolean {
  if (!Number.isFinite(maxResponseBytes) || maxResponseBytes <= 0) return false;
  return Buffer.byteLength(bodyText, "utf8") > Math.floor(maxResponseBytes);
}

function getProtocolVersionParam(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const rec = params as Record<string, unknown>;
  const pv = rec.protocolVersion;
  return typeof pv === "string" ? pv : undefined;
}

type OptionalCursorParse =
  | Readonly<{ ok: true; cursor: string | null }>
  | Readonly<{ ok: false }>;

function parseOptionalCursor(params: unknown): OptionalCursorParse {
  if (params === undefined || params === null) return { ok: true, cursor: null };
  if (typeof params !== "object" || Array.isArray(params)) return { ok: false };
  const rec = params as Record<string, unknown>;
  const c = rec.cursor;
  if (c === undefined || c === null) return { ok: true, cursor: null };
  if (typeof c !== "string") return { ok: false };
  return { ok: true, cursor: c };
}

type ToolsCallParams =
  | Readonly<{ ok: true; name: string; arguments: unknown }>
  | Readonly<{ ok: false }>;

function parseToolsCallParams(params: unknown): ToolsCallParams {
  if (!params || typeof params !== "object" || Array.isArray(params)) return { ok: false };
  const rec = params as Record<string, unknown>;
  const name = rec.name;
  if (typeof name !== "string" || name.length === 0) return { ok: false };
  const args = rec.arguments;
  // MCP allows arguments to be omitted; treat as empty object.
  if (args === undefined) return { ok: true, name, arguments: {} };
  // Fail closed: arguments must be an object (schemas expect object roots).
  if (args === null || typeof args !== "object" || Array.isArray(args)) return { ok: false };
  return { ok: true, name, arguments: args };
}

function getHeader(headers: Readonly<Record<string, string>>, lowerKey: string): string | undefined {
  // Prefer exact lower-case (router commonly normalizes to lower-case).
  const direct = headers[lowerKey];
  if (direct) return direct;

  // Fallback: case-insensitive scan (defensive).
  const target = lowerKey.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target && v) return v;
  }
  return undefined;
}
