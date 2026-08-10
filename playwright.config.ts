import { defineConfig, devices } from "@playwright/test";

/**
 * Configuração do Playwright para o E2E de login admin (Task 10).
 *
 * `webServer` builda e sobe o Next.js em modo produção (não `next dev`) para
 * o teste exercitar o mesmo artefato que vai para deploy. `globalSetup`
 * seeda o usuário `admin@allset.test` (ver `tests/e2e/seed.ts`) antes de
 * qualquer teste rodar.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/seed.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `exactOptionalPropertyTypes` do tsconfig rejeita `workers: undefined`
  // explícito (o tipo é `string | number`, sem `| undefined`) — só incluímos
  // a chave quando há valor real, via spread condicional.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    // Nesta versão do Playwright (1.62), `screenshot` não aceita o literal
    // "on-first-retry" (só `trace`/`video` aceitam) — `ScreenshotMode` é
    // 'off' | 'on' | 'only-on-failure' | 'on-first-failure'. Usamos
    // "on-first-failure", o equivalente mais próximo: só captura no
    // primeiro fracasso, mantendo a saída limpa em runs 100% verdes.
    screenshot: "on-first-failure",
    video: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
