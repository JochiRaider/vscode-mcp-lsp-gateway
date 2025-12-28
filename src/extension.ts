// src/extensions.ts

import * as vscode from 'vscode';
import { createMcpPostHandler } from './mcp/handler.js';
import { SchemaRegistry } from './tools/schemaRegistry.js';
import { HttpServer } from './server/httpServer.js';
import { computeAllowedRoots } from './workspace/roots.js';

type GatewaySettings = Readonly<{
  enabled: boolean;
  bindAddress: '127.0.0.1';
  port: number;
  endpointPath: '/mcp';
  secretStorageKey: string;
  allowedOrigins: readonly string[];
  additionalAllowedRoots: readonly string[];
  enableSessions: boolean;
  maxItemsPerPage: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  debugLogging: boolean;
}>;

const EXT_NS = 'mcpLspGateway';
const OUT_CHAN_NAME = 'MCP LSP Gateway';

/**
 * NOTE: This intentionally fails closed. If a setting is invalid or expands trust
 * boundaries beyond v1, we treat the server as disabled.
 */
function readAndValidateSettings(): { settings?: GatewaySettings; problems: string[] } {
  const cfg = vscode.workspace.getConfiguration(EXT_NS);

  const enabled = !!cfg.get<boolean>('enabled', false);
  const bindAddress = String(cfg.get<string>('bindAddress', '127.0.0.1'));
  const port = Number(cfg.get<number>('port', 3939));
  const endpointPath = String(cfg.get<string>('endpointPath', '/mcp'));

  const secretStorageKey = String(cfg.get<string>('secretStorageKey', `${EXT_NS}.authTokens`));
  const allowedOrigins = (cfg.get<readonly string[]>('allowedOrigins', []) ?? []).map(String);
  const additionalAllowedRoots = (
    cfg.get<readonly string[]>('additionalAllowedRoots', []) ?? []
  ).map(String);

  const enableSessions = !!cfg.get<boolean>('enableSessions', true);
  const maxItemsPerPage = Number(cfg.get<number>('maxItemsPerPage', 200));
  const maxResponseBytes = Number(cfg.get<number>('maxResponseBytes', 524_288));
  const requestTimeoutMs = Number(cfg.get<number>('requestTimeoutMs', 2_000));
  const debugLogging = !!cfg.get<boolean>('debugLogging', false);

  const problems: string[] = [];

  // v1 invariant: localhost only; refuse to start otherwise.
  if (bindAddress !== '127.0.0.1')
    problems.push(`bindAddress must be "127.0.0.1" (got "${bindAddress}").`);

  // v1 invariant: single endpoint /mcp.
  if (endpointPath !== '/mcp')
    problems.push(`endpointPath must be "/mcp" (got "${endpointPath}").`);

  // Minimal sanity checks (package.json already constrains these, but we still fail closed).
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    problems.push(`port must be an integer in [1024, 65535] (got "${port}").`);

  if (!Number.isInteger(maxItemsPerPage) || maxItemsPerPage < 1 || maxItemsPerPage > 200)
    problems.push(`maxItemsPerPage must be an integer in [1, 200] (got "${maxItemsPerPage}").`);

  if (
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 16_384 ||
    maxResponseBytes > 524_288
  )
    problems.push(
      `maxResponseBytes must be an integer in [16384, 524288] (got "${maxResponseBytes}").`,
    );

  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 250 || requestTimeoutMs > 2_000)
    problems.push(
      `requestTimeoutMs must be an integer in [250, 2000] (got "${requestTimeoutMs}").`,
    );

  if (problems.length) return { problems };

  return {
    problems,
    settings: {
      enabled,
      bindAddress: '127.0.0.1',
      port,
      endpointPath: '/mcp',
      secretStorageKey,
      allowedOrigins,
      additionalAllowedRoots,
      enableSessions,
      maxItemsPerPage,
      maxResponseBytes,
      requestTimeoutMs,
      debugLogging,
    },
  };
}

function buildBaseUrl(settings: GatewaySettings): string {
  return `http://${settings.bindAddress}:${settings.port}${settings.endpointPath}`;
}

/**
 * Token storage format (SecretStorage):
 *   JSON array of strings, e.g. ["tokenA","tokenB"]
 *
 * We keep this logic in extension.ts so command UX is independent from auth.ts,
 * but the server/auth layer should be the sole verifier at request time.
 */
async function setBearerTokensCommand(context: vscode.ExtensionContext): Promise<void> {
  const { settings, problems } = readAndValidateSettings();
  if (!settings) {
    void vscode.window.showErrorMessage(
      `Cannot set tokens: invalid configuration. ${problems.join(' ')}`,
    );
    return;
  }

  const raw = await vscode.window.showInputBox({
    title: 'Set Bearer Token(s)',
    prompt: 'Paste one or more tokens. Separate multiple tokens with commas or whitespace.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'Token(s) required.' : undefined),
  });
  if (!raw) return;

  const tokens = raw
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    void vscode.window.showErrorMessage('No valid tokens found.');
    return;
  }

  // Never log tokens.
  await context.secrets.store(settings.secretStorageKey, JSON.stringify(tokens));
  void vscode.window.showInformationMessage(
    `Stored ${tokens.length} bearer token(s) in SecretStorage.`,
  );
}

async function clearBearerTokensCommand(context: vscode.ExtensionContext): Promise<void> {
  const { settings, problems } = readAndValidateSettings();
  if (!settings) {
    void vscode.window.showErrorMessage(
      `Cannot clear tokens: invalid configuration. ${problems.join(' ')}`,
    );
    return;
  }
  await context.secrets.delete(settings.secretStorageKey);
  void vscode.window.showInformationMessage('Cleared bearer token(s) from SecretStorage.');
}

async function copyEndpointUrlCommand(): Promise<void> {
  const { settings, problems } = readAndValidateSettings();
  if (!settings) {
    void vscode.window.showErrorMessage(
      `Cannot copy endpoint URL: invalid configuration. ${problems.join(' ')}`,
    );
    return;
  }
  const url = buildBaseUrl(settings);
  await vscode.env.clipboard.writeText(url);
  void vscode.window.showInformationMessage('Copied MCP endpoint URL to clipboard.');
}

class ExtensionRuntime {
  public constructor(private readonly context: vscode.ExtensionContext) {}
  private readonly output = vscode.window.createOutputChannel(OUT_CHAN_NAME);
  private server: HttpServer | undefined;

  private restartTimer: NodeJS.Timeout | undefined;
  private lastStartKey: string | undefined;

  public dispose(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    void this.stopServer();
    this.output.dispose();
  }

  public async ensureStartedIfEnabled(): Promise<void> {
    // Never start in Restricted Mode. package.json also declares this, but enforce at runtime.
    if (!vscode.workspace.isTrusted) {
      await this.stopServer();
      this.output.appendLine('[info] Workspace is not trusted; server will not start.');
      return;
    }

    const { settings, problems } = readAndValidateSettings();
    if (!settings) {
      await this.stopServer();
      this.output.appendLine(
        `[error] Invalid configuration; server will not start. ${problems.join(' ')}`,
      );
      return;
    }

    if (!settings.enabled) {
      await this.stopServer();
      return;
    }

    const startKey = JSON.stringify({
      bindAddress: settings.bindAddress,
      port: settings.port,
      endpointPath: settings.endpointPath,
      enableSessions: settings.enableSessions,
      maxItemsPerPage: settings.maxItemsPerPage,
      maxResponseBytes: settings.maxResponseBytes,
      requestTimeoutMs: settings.requestTimeoutMs,
      debugLogging: settings.debugLogging,
      allowedOrigins: settings.allowedOrigins,
      additionalAllowedRoots: settings.additionalAllowedRoots,
      secretStorageKey: settings.secretStorageKey,
    });

    if (this.server && this.lastStartKey === startKey) return;

    await this.stopServer();

    // Step 6: compile schemas once (fail closed) so:
    // - tools/list can return inputSchema objects
    // - tools/call can validate params deterministically via Ajv
    let schemaRegistry: SchemaRegistry;
    try {
      schemaRegistry = await SchemaRegistry.getOrCreate(this.context);
    } catch (err) {
      this.output.appendLine(
        `[error] Failed to load/compile tool schemas; server will not start. ${String(err).slice(0, 500)}`,
      );
      return;
    }

    // Compute allowed roots once at server start (workspace folders + additional roots),
    // canonicalized to realpaths for URI gating.
    let allowedRootsRealpaths: readonly string[];
    try {
      const allowed = await computeAllowedRoots(settings.additionalAllowedRoots);
      allowedRootsRealpaths = allowed.roots;
    } catch (err) {
      this.output.appendLine(
        `[error] Failed to compute allowed roots; server will not start. ${String(err).slice(0, 500)}`,
      );
      return;
    }

    const pkg = this.context.extension.packageJSON as Record<string, unknown>;
    const serverInfo = {
      name:
        (typeof pkg['displayName'] === 'string' && pkg['displayName']) ||
        (typeof pkg['name'] === 'string' && pkg['name']) ||
        'mcp-lsp-gateway',
      version: (typeof pkg['version'] === 'string' && pkg['version']) || '0.0.0',
    };

    const onMcpPost = createMcpPostHandler({
      protocolVersion: '2025-11-25',
      serverInfo,
      enableSessions: settings.enableSessions,
      schemaRegistry,
      maxItemsPerPage: settings.maxItemsPerPage,
      maxResponseBytes: settings.maxResponseBytes,
      requestTimeoutMs: settings.requestTimeoutMs,
      allowedRootsRealpaths,
      // Keep fail-closed unless you have a reproduced interop issue + a smoke test.
      allowMissingProtocolVersionOnInitializedNotification: false,
    });

    this.server = new HttpServer({
      settings,
      secrets: this.context.secrets,
      output: this.output,
      onMcpPost,
    });

    try {
      await this.server.start();
      this.lastStartKey = startKey;
      this.output.appendLine(
        `[info] MCP server listening on ${buildBaseUrl(settings)} (localhost-only).`,
      );
    } catch (err) {
      this.output.appendLine(
        `[error] Failed to start MCP server; it will remain stopped. ${String(err).slice(0, 500)}`,
      );
      await this.stopServer();
    }
  }

  public scheduleRestart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.ensureStartedIfEnabled();
    }, 150);
  }

  private async stopServer(): Promise<void> {
    if (!this.server) return;
    try {
      await this.server.stop();
      this.output.appendLine('[info] MCP server stopped.');
    } catch (err) {
      // Do not include secrets/raw payloads; keep logs bounded.
      this.output.appendLine(`[error] Failed to stop server: ${String(err).slice(0, 500)}`);
    } finally {
      this.server = undefined;
      this.lastStartKey = undefined;
    }
  }
}

let runtime: ExtensionRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  runtime = new ExtensionRuntime(context);
  context.subscriptions.push({ dispose: () => runtime?.dispose() });

  // Commands (must match package.json).
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpLspGateway.setBearerTokens', () =>
      setBearerTokensCommand(context),
    ),
    vscode.commands.registerCommand('mcpLspGateway.clearBearerTokens', () =>
      clearBearerTokensCommand(context),
    ),
    vscode.commands.registerCommand('mcpLspGateway.copyEndpointUrl', () =>
      copyEndpointUrlCommand(),
    ),
  );

  // Start if enabled.
  await runtime.ensureStartedIfEnabled();

  // Restart on relevant configuration changes.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(EXT_NS)) return;
      runtime?.scheduleRestart();
    }),
  );

  // Restart if workspace folder set changes (keeps allowedRootsRealpaths accurate).
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      runtime?.scheduleRestart();
    }),
  );
  // Optional: restart on token updates (so auth changes are immediately effective even if auth.ts caches).
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      const { settings } = readAndValidateSettings();
      if (!settings) return;
      if (e.key === settings.secretStorageKey) runtime?.scheduleRestart();
    }),
  );
}

export function deactivate(): void {
  runtime?.dispose();
  runtime = undefined;
}
