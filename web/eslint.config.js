import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: globals.browser },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Config files and the asset generators in tools/ run under Node, not in a
    // browser, and are not part of the client bundle.
    files: ["*.config.ts", "*.config.js", "tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  // Must stay last: turns off every rule Prettier already handles.
  prettier,
);
