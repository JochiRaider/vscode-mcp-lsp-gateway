// eslint.config.mjs
// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // Ignore build artifacts
  {
    ignores: ['dist/**', 'out/**', 'node_modules/**', 'coverage/**'],
  },

  // Base JS recommended rules
  eslint.configs.recommended,

  // TypeScript linting (scoped to TS only; do not run TS project service on JS/MJS files)
  ...tseslint.configs.recommended.map((c) => ({
    ...c,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['src/**/*.ts', 'test/**/*.ts'],
  })),

  // Put Prettier last: it disables ESLint rules that conflict with Prettier
  eslintConfigPrettier,
);
