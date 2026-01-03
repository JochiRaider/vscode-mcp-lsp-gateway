import { expect } from 'chai';
import { createLogger, redactHeaders } from '../../src/logging/redact.js';
import type * as vscode from 'vscode';

class FakeOutputChannel {
  public lines: string[] = [];

  public appendLine(line: string): void {
    this.lines.push(line);
  }
}

describe('redaction', () => {
  it('redacts authorization and session ids in structured meta', () => {
    const output = new FakeOutputChannel();
    const logger = createLogger(output as unknown as vscode.OutputChannel, {
      debugEnabled: true,
      maxChars: 2048,
    });

    logger.debug('test', {
      authorization: 'Bearer secret-token',
      'mcp-session-id': 'session-123',
      nested: { Authorization: 'Bearer another-secret' },
    });

    const line = output.lines[0] ?? '';
    expect(line).to.include('[REDACTED]');
    expect(line).to.not.include('secret-token');
    expect(line).to.not.include('another-secret');
    expect(line).to.not.include('session-123');
  });

  it('redacts session id and authorization headers in header maps', () => {
    const redacted = redactHeaders({
      'MCP-Session-Id': 'session-123',
      authorization: 'Bearer secret-token',
      'content-type': 'application/json',
    });

    expect(redacted['MCP-Session-Id']).to.equal('[REDACTED]');
    expect(redacted['authorization']).to.equal('[REDACTED]');
    expect(redacted['content-type']).to.equal('application/json');
  });

  it('bounds debug log output deterministically', () => {
    const output = new FakeOutputChannel();
    const logger = createLogger(output as unknown as vscode.OutputChannel, {
      debugEnabled: true,
      maxChars: 80,
    });

    logger.debug('test', { payload: 'x'.repeat(200) });

    const line = output.lines[0] ?? '';
    expect(line.length).to.be.at.most(80);
    expect(line).to.include('[truncated]');
  });
});
