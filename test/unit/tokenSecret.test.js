'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const tokenSecret_1 = require('../../src/server/tokenSecret');
class FakeSecrets {
  raw;
  stored;
  storeCalls = 0;
  constructor(raw) {
    this.raw = raw;
  }
  get() {
    return Promise.resolve(this.raw);
  }
  store(_key, value) {
    this.storeCalls += 1;
    this.stored = value;
    return Promise.resolve();
  }
  delete() {
    return Promise.resolve();
  }
}
describe('token secret parsing', () => {
  it('treats missing secret as missing', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)(undefined);
    (0, chai_1.expect)(parsed.kind).to.equal('missing');
  });
  it('parses valid token arrays', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)('["tokenA"," tokenB "]');
    (0, chai_1.expect)(parsed.kind).to.equal('valid');
    if (parsed.kind === 'valid') {
      (0, chai_1.expect)(parsed.tokens).to.deep.equal(['tokenA', 'tokenB']);
    }
  });
  it('treats empty arrays as valid with no tokens', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)('[]');
    (0, chai_1.expect)(parsed.kind).to.equal('valid');
    if (parsed.kind === 'valid') {
      (0, chai_1.expect)(parsed.tokens).to.deep.equal([]);
    }
  });
  it('rejects invalid JSON', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)('not-json');
    (0, chai_1.expect)(parsed.kind).to.equal('invalid');
  });
  it('rejects non-array secrets', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)('{"token":"a"}');
    (0, chai_1.expect)(parsed.kind).to.equal('invalid');
  });
  it('rejects arrays with non-string values', () => {
    const parsed = (0, tokenSecret_1.parseTokenSecret)('["a", 1]');
    (0, chai_1.expect)(parsed.kind).to.equal('invalid');
  });
});
describe('ensureBearerTokenPresent', () => {
  it('auto-provisions when secret is missing', async () => {
    const secrets = new FakeSecrets(undefined);
    const result = await (0, tokenSecret_1.ensureBearerTokenPresent)(
      secrets,
      'mcpLspGateway.authTokens',
    );
    (0, chai_1.expect)(result.ok).to.equal(true);
    if (result.ok) {
      (0, chai_1.expect)(result.created).to.equal(true);
    }
    (0, chai_1.expect)(secrets.storeCalls).to.equal(1);
    (0, chai_1.expect)(secrets.stored).to.be.a('string');
    const stored = JSON.parse(secrets.stored ?? '[]');
    (0, chai_1.expect)(stored).to.have.length(1);
    (0, chai_1.expect)(stored[0].length).to.be.greaterThan(31);
  });
  it('auto-provisions when secret is an empty array', async () => {
    const secrets = new FakeSecrets('[]');
    const result = await (0, tokenSecret_1.ensureBearerTokenPresent)(
      secrets,
      'mcpLspGateway.authTokens',
    );
    (0, chai_1.expect)(result.ok).to.equal(true);
    if (result.ok) {
      (0, chai_1.expect)(result.created).to.equal(true);
    }
    (0, chai_1.expect)(secrets.storeCalls).to.equal(1);
  });
  it('does not overwrite existing tokens', async () => {
    const secrets = new FakeSecrets('["a","b"]');
    const result = await (0, tokenSecret_1.ensureBearerTokenPresent)(
      secrets,
      'mcpLspGateway.authTokens',
    );
    (0, chai_1.expect)(result.ok).to.equal(true);
    if (result.ok) {
      (0, chai_1.expect)(result.created).to.equal(false);
    }
    (0, chai_1.expect)(secrets.storeCalls).to.equal(0);
  });
  it('fails closed on malformed secrets', async () => {
    const secrets = new FakeSecrets('not-json');
    const result = await (0, tokenSecret_1.ensureBearerTokenPresent)(
      secrets,
      'mcpLspGateway.authTokens',
    );
    (0, chai_1.expect)(result.ok).to.equal(false);
    if (!result.ok) {
      (0, chai_1.expect)(result.reason).to.include('malformed');
    }
    (0, chai_1.expect)(secrets.storeCalls).to.equal(0);
  });
});
//# sourceMappingURL=tokenSecret.test.js.map
