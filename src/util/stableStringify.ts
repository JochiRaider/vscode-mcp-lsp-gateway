import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const stableStringify = require('fast-stable-stringify') as (value: unknown) => string;

export function stableJsonStringify(value: unknown): string {
  return stableStringify(value);
}
