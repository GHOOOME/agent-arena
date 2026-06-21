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
    ".codex-runtime/**",
    "electron/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local agent/skill installs are vendored tool packages, not app source.
    ".agents/**",
    ".claude/**",
    ".cursor/**",
    ".gemini/**",
    ".kiro/**",
    ".qoder/**",
  ]),
]);

export default eslintConfig;
