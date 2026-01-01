import { expect } from 'chai';
import { buildCodexConfigToml } from '../../src/util/codexConfigToml.js';

describe('buildCodexConfigToml', () => {
  it('builds a deterministic token-inline stanza', () => {
    const toml = buildCodexConfigToml({
      bindAddress: '127.0.0.1',
      port: 3939,
      endpointPath: '/mcp',
      token: 'token-123',
    });

    const expected = [
      '# vscode-mcp-lsp-gateway (local-only)',
      '# Required MCP protocol version header: 2025-11-25',
      '[mcp_servers.vscode_mcp_lsp_gateway]',
      'url = "http://127.0.0.1:3939/mcp"',
      'http_headers = { "Authorization" = "Bearer token-123", "MCP-Protocol-Version" = "2025-11-25", "Accept" = "application/json, text/event-stream", "Content-Type" = "application/json" }',
      'enabled = true',
      'startup_timeout_sec = 10',
      'tool_timeout_sec = 60',
      '',
    ].join('\n');

    expect(toml).to.equal(expected);
  });
});
