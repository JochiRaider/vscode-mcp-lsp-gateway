'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const chai_1 = require('chai');
const sorting_1 = require('../../src/tools/sorting');
describe('sorting helpers', () => {
  it('sorts locations by uri and range', () => {
    const a = {
      uri: 'file:///b.ts',
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      },
    };
    const b = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 2 },
      },
    };
    const c = {
      uri: 'file:///b.ts',
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
    };
    const items = [a, b, c];
    items.sort(sorting_1.compareLocations);
    (0, chai_1.expect)(items).to.deep.equal([b, c, a]);
  });
  it('dedupes a sorted list deterministically by canonical JSON', () => {
    const a = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    };
    const b = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    };
    const c = {
      uri: 'file:///b.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    };
    const sorted = [a, b, c].sort(sorting_1.compareLocations);
    const deduped = (0, sorting_1.dedupeSortedByKey)(sorted, sorting_1.canonicalDedupeKey);
    (0, chai_1.expect)(deduped).to.deep.equal([a, c]);
  });
  it('sorts diagnostics with missing-last semantics', () => {
    const a = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: 'a',
    };
    const b = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      severity: 1,
      message: 'b',
    };
    const c = {
      uri: 'file:///b.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: 'c',
    };
    const items = [a, b, c];
    items.sort(sorting_1.compareDiagnostics);
    (0, chai_1.expect)(items).to.deep.equal([b, a, c]);
  });
});
//# sourceMappingURL=sorting.test.js.map
