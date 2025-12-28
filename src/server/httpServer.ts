import * as http from "node:http";
import type * as vscode from "vscode";
import { createLogger } from "../logging/redact.js";
import { AuthVerifier } from "./auth.js";
import { createRouter, MAX_REQUEST_BYTES, type McpPostHandler } from "./router.js";

export type GatewaySettings = Readonly<{
  enabled: boolean;
  bindAddress: "127.0.0.1";
  port: number;
  endpointPath: "/mcp";

  // boundary controls
  secretStorageKey: string;
  allowedOrigins: readonly string[];
  additionalAllowedRoots: readonly string[];
  enableSessions: boolean;

  maxItemsPerPage: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  debugLogging: boolean;
}>;

export class HttpServer {
  private server: http.Server | undefined;

  public constructor(
    private readonly deps: {
      settings: GatewaySettings;
      secrets: vscode.SecretStorage;
      output: vscode.OutputChannel;
      /**
       * Optional override so later steps can inject the full MCP JSON-RPC pipeline.
       * For Step 2, if omitted, /mcp requests are accepted at the transport layer
       * but will return 500 (unimplemented handler).
       */
      onMcpPost?: McpPostHandler;
    },
  ) {}

  public async start(): Promise<void> {
    if (this.server) return;

    const { settings } = this.deps;

    // Fail closed: localhost-only.
    if (settings.bindAddress !== "127.0.0.1") {
      throw new Error(`Refusing to bind to non-loopback address: ${settings.bindAddress}`);
    }

    const logger = createLogger(this.deps.output, { debugEnabled: settings.debugLogging });
    const auth = await AuthVerifier.createFromSecretStorage(this.deps.secrets, settings.secretStorageKey);

    const requestListener = createRouter({
      endpointPath: settings.endpointPath,
      maxRequestBytes: MAX_REQUEST_BYTES,
      allowedOrigins: settings.allowedOrigins,
      auth,
      logger,
      ...(this.deps.onMcpPost ? { onMcpPost: this.deps.onMcpPost } : {}),
    });

    this.server = http.createServer(requestListener);

    // Keep timeouts conservative; Step 2 focuses on request-size + header enforcement.
    // (You can tighten timeouts further when limits.ts is implemented.)
    this.server.requestTimeout = Math.max(250, Math.min(settings.requestTimeoutMs, 120_000));

    await new Promise<void>((resolve, reject) => {
      const srv = this.server!;
      const onError = (err: Error) => {
        srv.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        srv.off("error", onError);
        resolve();
      };
      srv.once("error", onError);
      srv.once("listening", onListening);
      srv.listen(settings.port, settings.bindAddress);
    });

    if (settings.debugLogging) {
      this.deps.output.appendLine(
        `[debug] HTTP server started on http://${settings.bindAddress}:${settings.port}${settings.endpointPath}`,
      );
    }
  }

  public async stop(): Promise<void> {
    const srv = this.server;
    if (!srv) return;

    this.server = undefined;

    await new Promise<void>((resolve) => {
      // close() stops accepting new connections; existing keep-alives may remain briefly.
      srv.close(() => resolve());
    });

    if (this.deps.settings.debugLogging) {
      this.deps.output.appendLine("[debug] HTTP server stopped.");
    }
  }
}
