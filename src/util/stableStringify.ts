import stableStringify from 'fast-stable-stringify';

export function stableJsonStringify(value: unknown): string {
  return stableStringify(value);
}
