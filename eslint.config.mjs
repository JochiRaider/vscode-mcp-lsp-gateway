// eslint.config.mjs
// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  // Ignore build artifacts
  {
    ignores: ["dist/**", "out/**", "node_modules/**", "coverage/**"],
  },

  // Base JS recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules (non-type-aware)
  tseslint.configs.recommended,

  // Type-aware rules (the “type-checked preset”)
  tseslint.configs.recommendedTypeChecked,

  // Enable Project Service (recommended) so type-aware rules can work reliably
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
  },

  // Put Prettier last: it disables ESLint rules that conflict with Prettier
  eslintConfigPrettier,
);
