import { expect } from 'chai';
import {
  canonicalDedupeKey,
  compareDiagnostics,
  compareLocations,
  compareDocumentSymbols,
  compareWorkspaceSymbols,
  dedupeSortedByKey,
} from '../../src/tools/sorting.js';

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

  it('produces a stable canonical dedupe key for object key order', () => {
    const one = { b: 2, a: 1 };
    const two = { a: 1, b: 2 };
    expect(canonicalDedupeKey(one)).to.equal(canonicalDedupeKey(two));
  });

  it('sorts document symbols with tie-breakers and missing-last containerName', () => {
    const baseRange = {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 1 },
    };
    const a = { name: 'b', kind: 2, range: baseRange, selectionRange: baseRange };
    const b = { name: 'a', kind: 2, range: baseRange, selectionRange: baseRange };
    const c = {
      name: 'a',
      kind: 2,
      range: baseRange,
      selectionRange: baseRange,
      containerName: 'container',
    };
    const items = [a, b, c];
    items.sort(compareDocumentSymbols);
    expect(items).to.deep.equal([c, b, a]);
  });

  it('sorts workspace symbols with tie-breakers and missing-last containerName', () => {
    const loc = {
      uri: 'file:///a.ts',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    };
    const a = { name: 'b', kind: 2, location: loc };
    const b = { name: 'a', kind: 2, location: loc };
    const c = { name: 'a', kind: 2, location: loc, containerName: 'container' };
    const items = [a, b, c];
    items.sort(compareWorkspaceSymbols);
    expect(items).to.deep.equal([c, b, a]);
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
