import { expect } from 'chai';
import { stableIdFromCanonicalString } from '../../src/tools/ids.js';

describe('stableIdFromCanonicalString', () => {
  it('returns deterministic sha256: ids', () => {
    const id1 = stableIdFromCanonicalString('a|b|c');
    const id2 = stableIdFromCanonicalString('a|b|c');
    const id3 = stableIdFromCanonicalString('a|b|d');

    expect(id1).to.equal(id2);
    expect(id1).to.not.equal(id3);
  });

  it('matches the sha256:<hex> format', () => {
    const id = stableIdFromCanonicalString('canonical');
    expect(id).to.match(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns the expected sha256 for a stable input', () => {
    const id = stableIdFromCanonicalString('canonical');
    expect(id).to.equal('sha256:0deeb8fa1dbbee4c0dbe7f5e3c9183940139f26d22797ee8ab07c00557a4c2ff');
  });
});
