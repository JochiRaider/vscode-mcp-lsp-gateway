import { expect } from 'chai';
import { stableJsonStringify } from '../../src/util/stableStringify.js';

describe('stableJsonStringify', () => {
  it('produces stable output regardless of key insertion order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };

    expect(stableJsonStringify(a)).to.equal(stableJsonStringify(b));
    expect(stableJsonStringify(a)).to.equal('{"a":2,"b":1}');
  });

  it('stabilizes nested objects while preserving array order', () => {
    const a = { z: [{ b: 1, a: 2 }], a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, z: [{ a: 2, b: 1 }] };

    expect(stableJsonStringify(a)).to.equal(stableJsonStringify(b));
    expect(stableJsonStringify(a)).to.equal('{"a":{"c":3,"d":4},"z":[{"a":2,"b":1}]}');
  });
});
