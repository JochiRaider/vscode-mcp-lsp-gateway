// src/tools/sorting.ts
//
// Shared stable sorting + deterministic dedupe helpers (CONTRACT §4.2, §4.3).

import { stableJsonStringify } from '../util/stableStringify.js';

export type ContractPosition = Readonly<{ line: number; character: number }>;
export type ContractRange = Readonly<{ start: ContractPosition; end: ContractPosition }>;
export type ContractLocation = Readonly<{ uri: string; range: ContractRange }>;

export type ContractDocumentSymbol = Readonly<{
  name: string;
  kind: number;
  range: ContractRange;
  selectionRange: ContractRange;
  containerName?: string;
}>;

export type ContractWorkspaceSymbol = Readonly<{
  name: string;
  kind: number;
  location: ContractLocation;
  containerName?: string;
}>;

export type ContractDiagnostic = Readonly<{
  uri?: string;
  range: ContractRange;
  severity?: number;
  code?: string;
  source?: string;
  message: string;
}>;

export function compareLocations(a: ContractLocation, b: ContractLocation): number {
  if (a.uri !== b.uri) return a.uri < b.uri ? -1 : 1;
  return compareRanges(a.range, b.range);
}

export function compareDocumentSymbols(
  a: ContractDocumentSymbol,
  b: ContractDocumentSymbol,
): number {
  const r = compareRanges(a.range, b.range);
  if (r !== 0) return r;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.kind !== b.kind) return a.kind - b.kind;
  return compareOptionalStringMissingLast(a.containerName, b.containerName);
}

export function compareWorkspaceSymbols(
  a: ContractWorkspaceSymbol,
  b: ContractWorkspaceSymbol,
): number {
  const loc = compareLocations(a.location, b.location);
  if (loc !== 0) return loc;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.kind !== b.kind) return a.kind - b.kind;
  return compareOptionalStringMissingLast(a.containerName, b.containerName);
}

export function compareDiagnostics(a: ContractDiagnostic, b: ContractDiagnostic): number {
  const au = a.uri ?? '';
  const bu = b.uri ?? '';
  if (au !== bu) return au < bu ? -1 : 1;

  const r = compareRanges(a.range, b.range);
  if (r !== 0) return r;

  const sev = compareOptionalNumberMissingLast(a.severity, b.severity);
  if (sev !== 0) return sev;

  const code = compareOptionalStringMissingLast(a.code, b.code);
  if (code !== 0) return code;

  const source = compareOptionalStringMissingLast(a.source, b.source);
  if (source !== 0) return source;

  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export function dedupeSortedByKey<T>(items: readonly T[], keyFn: (item: T) => string): T[] {
  const out: T[] = [];
  let lastKey: string | undefined;

  for (const item of items) {
    const key = keyFn(item);
    if (key === lastKey) continue;
    out.push(item);
    lastKey = key;
  }

  return out;
}

export function canonicalDedupeKey(value: unknown): string {
  return stableJsonStringify(value);
}

function compareRanges(a: ContractRange, b: ContractRange): number {
  const s = comparePositions(a.start, b.start);
  if (s !== 0) return s;
  return comparePositions(a.end, b.end);
}

function comparePositions(a: ContractPosition, b: ContractPosition): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.character !== b.character) return a.character - b.character;
  return 0;
}

function compareOptionalStringMissingLast(a: string | undefined, b: string | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  if (a !== b) return a < b ? -1 : 1;
  return 0;
}

function compareOptionalNumberMissingLast(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}
