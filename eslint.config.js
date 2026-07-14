// ESLint v9 flat config
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".memory/**", ".skills/**", "*.config.js"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Code style (semantic — Prettier handles formatting)
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      "@typescript-eslint/no-non-null-assertion": "off",

      // Allow empty catch blocks where intentional (the codebase uses these)
      "no-empty": ["error", { allowEmptyCatch: true }],

      // Disable stylistic rules that conflict with Prettier
      "@typescript-eslint/no-extra-semi": "off",
    },
  }
);
