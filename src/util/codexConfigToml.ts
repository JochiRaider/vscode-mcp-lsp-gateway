type CodexConfigTomlOptions = Readonly<{
  bindAddress: string;
  port: number;
  endpointPath: string;
  token: string;
}>;

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildCodexConfigToml(options: CodexConfigTomlOptions): string {
  const url = `http://${options.bindAddress}:${options.port}${options.endpointPath}`;
  const token = escapeTomlString(options.token);
  return [
    '# vscode-mcp-lsp-gateway (local-only)',
    '# Required MCP protocol version header: 2025-11-25',
    '[mcp_servers.vscode_mcp_lsp_gateway]',
    `url = "${url}"`,
    `http_headers = { "Authorization" = "Bearer ${token}", "MCP-Protocol-Version" = "2025-11-25", "Accept" = "application/json, text/event-stream", "Content-Type" = "application/json" }`,
    'enabled = true',
    'startup_timeout_sec = 10',
    'tool_timeout_sec = 60',
    '',
  ].join('\n');
}
