import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    // Note: This alias duplicates tsconfig.json's paths entry — could use vite-tsconfig-paths plugin to unify
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
