import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    // .dependency-cruiser.cjs precisa ser CommonJS (module.exports) — é a
    // extensão exigida pela própria ferramenta, mesmo com "type": "module"
    // no package.json — por isso fica fora do lint de código-fonte.
    ignores: [".next/**", "node_modules/**", "dist/**", "build/**", ".dependency-cruiser.cjs"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Convenção: parâmetros intencionalmente não usados (ex.: para satisfazer
      // uma interface de port) são prefixados com "_".
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
