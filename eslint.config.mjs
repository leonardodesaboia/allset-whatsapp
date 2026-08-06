import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "build/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];
