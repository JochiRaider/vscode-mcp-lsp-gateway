'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const stableStringify_1 = require('../../src/util/stableStringify');
describe('stableJsonStringify', () => {
  it('produces stable output regardless of key insertion order', () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    (0, chai_1.expect)((0, stableStringify_1.stableJsonStringify)(a)).to.equal(
      (0, stableStringify_1.stableJsonStringify)(b),
    );
    (0, chai_1.expect)((0, stableStringify_1.stableJsonStringify)(a)).to.equal('{"a":2,"b":1}');
  });
  it('stabilizes nested objects while preserving array order', () => {
    const a = { z: [{ b: 1, a: 2 }], a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, z: [{ a: 2, b: 1 }] };
    (0, chai_1.expect)((0, stableStringify_1.stableJsonStringify)(a)).to.equal(
      (0, stableStringify_1.stableJsonStringify)(b),
    );
    (0, chai_1.expect)((0, stableStringify_1.stableJsonStringify)(a)).to.equal(
      '{"a":{"c":3,"d":4},"z":[{"a":2,"b":1}]}',
    );
  });
});
//# sourceMappingURL=stableStringify.test.js.map
