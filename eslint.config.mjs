import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent worktrees contain their own generated .next trees. Without
    // this, `npm run lint` recursively lints compiled third-party output.
    ".claude/**",
    ".codex/**",
    // Design handoff bundles (reference HTML + vendored support.js), not app code.
    "docs/design/**",
    ".superpowers/**",
    "coverage/**",
    "dist/**",
    "backups/**",
    // Claude Design sync inputs + generated output (not app code).
    ".design-sync/**",
    ".ds-sync/**",
    "ds-bundle/**",
  ]),
]);

export default eslintConfig;
