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
    "coverage/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/clock.ts", "src/lib/date.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Use clock.now() from '@/lib/clock' instead of Date.now() to ensure deterministic, testable time."
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use clock.now() from '@/lib/clock' instead of new Date() without arguments."
        }
      ]
    }
  }
]);

export default eslintConfig;
