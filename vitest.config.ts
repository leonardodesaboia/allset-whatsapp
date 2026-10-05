import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      exclude: [
        "**/node_modules/**",
        "**/tests/**",
        "**/*.config.*",
        "src/app/**",
        "src/env.ts",
        "src/lib/**",
        "src/worker/main.ts",
      ],
    },
    // tests/e2e/*.spec.ts são testes do Playwright (Task 10), não do
    // Vitest — o glob padrão do Vitest também casa com "*.spec.ts" e tenta
    // importar `test()` do @playwright/test, que quebra fora do runner do
    // Playwright. Repetimos os excludes default do Vitest porque definir
    // `exclude` substitui a lista padrão em vez de somar a ela.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "**/tests/e2e/**",
    ],
  },
  resolve: {
    // Note: This alias duplicates tsconfig.json's paths entry — could use vite-tsconfig-paths plugin to unify
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
