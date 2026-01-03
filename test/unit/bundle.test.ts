import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const bundlePath = path.join(repoRoot, 'dist', 'extension.js');

describe('bundle', () => {
  it('does not contain runtime imports for bundled dependencies', () => {
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    const patterns: RegExp[] = [
      /createRequire\([^)]*\)\(['"]fast-stable-stringify['"]\)/,
      /require\(['"]fast-stable-stringify['"]\)/,
      /import\(['"]fast-stable-stringify['"]\)/,
      /from\s*['"]fast-stable-stringify['"]/,
      /createRequire\([^)]*\)\(['"]ajv['"]\)/,
      /require\(['"]ajv['"]\)/,
      /import\(['"]ajv['"]\)/,
      /from\s*['"]ajv['"]/,
    ];

    for (const pattern of patterns) {
      expect(bundle).to.not.match(pattern);
    }
  });
});
