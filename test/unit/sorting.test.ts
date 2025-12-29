import { expect } from 'chai';
import {
  canonicalDedupeKey,
  compareDiagnostics,
  compareLocations,
  dedupeSortedByKey,
} from '../../src/tools/sorting';

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
    items.sort(compareLocations);
    expect(items).to.deep.equal([b, c, a]);
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

    const sorted = [a, b, c].sort(compareLocations);
    const deduped = dedupeSortedByKey(sorted, canonicalDedupeKey);
    expect(deduped).to.deep.equal([a, c]);
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
    items.sort(compareDiagnostics);
    expect(items).to.deep.equal([b, a, c]);
  });
});
