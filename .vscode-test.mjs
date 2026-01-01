import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  extensionDevelopmentPath: dirname(fileURLToPath(import.meta.url)),
});
