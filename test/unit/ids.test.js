'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const ids_1 = require('../../src/tools/ids');
describe('stableIdFromCanonicalString', () => {
  it('returns deterministic sha256: ids', () => {
    const id1 = (0, ids_1.stableIdFromCanonicalString)('a|b|c');
    const id2 = (0, ids_1.stableIdFromCanonicalString)('a|b|c');
    const id3 = (0, ids_1.stableIdFromCanonicalString)('a|b|d');
    (0, chai_1.expect)(id1).to.equal(id2);
    (0, chai_1.expect)(id1).to.not.equal(id3);
  });
  it('matches the sha256:<hex> format', () => {
    const id = (0, ids_1.stableIdFromCanonicalString)('canonical');
    (0, chai_1.expect)(id).to.match(/^sha256:[0-9a-f]{64}$/);
  });
});
//# sourceMappingURL=ids.test.js.map
