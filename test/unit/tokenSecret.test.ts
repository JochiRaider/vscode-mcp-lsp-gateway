import { expect } from 'chai';
import * as vscode from 'vscode';
import { ensureBearerTokenPresent, parseTokenSecret } from '../../src/server/tokenSecret.js';

class FakeSecrets implements vscode.SecretStorage {
  public stored: string | undefined;
  public storeCalls = 0;
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  public readonly onDidChange = this.emitter.event;

  public constructor(private readonly raw: string | undefined) {}

  public keys(): Promise<string[]> {
    return Promise.resolve([]);
  }

  public get(key: string): Promise<string | undefined> {
    void key;
    return Promise.resolve(this.raw);
  }

  public store(_key: string, value: string): Promise<void> {
    this.storeCalls += 1;
    this.stored = value;
    this.emitter.fire({ key: _key });
    return Promise.resolve();
  }

  public delete(key: string): Promise<void> {
    if (key) this.emitter.fire({ key });
    return Promise.resolve();
  }
}

describe('token secret parsing', () => {
  it('treats missing secret as missing', () => {
    const parsed = parseTokenSecret(undefined);
    expect(parsed.kind).to.equal('missing');
  });

  it('parses valid token arrays', () => {
    const parsed = parseTokenSecret('["tokenA"," tokenB "]');
    expect(parsed.kind).to.equal('valid');
    if (parsed.kind === 'valid') {
      expect(parsed.tokens).to.deep.equal(['tokenA', 'tokenB']);
    }
  });

  it('treats empty arrays as valid with no tokens', () => {
    const parsed = parseTokenSecret('[]');
    expect(parsed.kind).to.equal('valid');
    if (parsed.kind === 'valid') {
      expect(parsed.tokens).to.deep.equal([]);
    }
  });

  it('rejects invalid JSON', () => {
    const parsed = parseTokenSecret('not-json');
    expect(parsed.kind).to.equal('invalid');
  });

  it('rejects non-array secrets', () => {
    const parsed = parseTokenSecret('{"token":"a"}');
    expect(parsed.kind).to.equal('invalid');
  });

  it('rejects arrays with non-string values', () => {
    const parsed = parseTokenSecret('["a", 1]');
    expect(parsed.kind).to.equal('invalid');
  });
});

describe('ensureBearerTokenPresent', () => {
  it('auto-provisions when secret is missing', async () => {
    const secrets = new FakeSecrets(undefined);
    const result = await ensureBearerTokenPresent(secrets, 'mcpLspGateway.authTokens');
    expect(result.ok).to.equal(true);
    if (result.ok) {
      expect(result.created).to.equal(true);
    }
    expect(secrets.storeCalls).to.equal(1);
    expect(secrets.stored).to.be.a('string');
    const stored = JSON.parse(secrets.stored ?? '[]') as string[];
    expect(stored).to.have.length(1);
    const first = stored[0];
    expect(first).to.not.equal(undefined);
    if (!first) throw new Error('Missing stored token');
    expect(first.length).to.be.greaterThan(31);
  });

  it('auto-provisions when secret is an empty array', async () => {
    const secrets = new FakeSecrets('[]');
    const result = await ensureBearerTokenPresent(secrets, 'mcpLspGateway.authTokens');
    expect(result.ok).to.equal(true);
    if (result.ok) {
      expect(result.created).to.equal(true);
    }
    expect(secrets.storeCalls).to.equal(1);
  });

  it('does not overwrite existing tokens', async () => {
    const secrets = new FakeSecrets('["a","b"]');
    const result = await ensureBearerTokenPresent(secrets, 'mcpLspGateway.authTokens');
    expect(result.ok).to.equal(true);
    if (result.ok) {
      expect(result.created).to.equal(false);
    }
    expect(secrets.storeCalls).to.equal(0);
  });

  it('fails closed on malformed secrets', async () => {
    const secrets = new FakeSecrets('not-json');
    const result = await ensureBearerTokenPresent(secrets, 'mcpLspGateway.authTokens');
    expect(result.ok).to.equal(false);
    if (!result.ok) {
      expect(result.reason).to.include('malformed');
    }
    expect(secrets.storeCalls).to.equal(0);
  });
});
