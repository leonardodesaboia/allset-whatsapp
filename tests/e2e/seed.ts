import dotenv from "dotenv";
import path from "path";

// globalSetup roda em um processo Node separado do webServer do Playwright
// (que é o próprio Next.js, e carrega .env sozinho) — precisamos carregar o
// .env manualmente aqui, mesmo padrão usado em vitest.setup.ts.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const ADMIN_EMAIL = "admin@allset.test";
const ADMIN_PASSWORD = "senha-super-segura-1";

/**
 * Seed do usuário admin de teste, usado pelo E2E de login (Task 10).
 *
 * Chamado como `globalSetup` do Playwright antes da suíte. Idempotente:
 * roda contra o banco local de desenvolvimento (não um Testcontainer
 * descartável), então precisa tolerar reexecuções sem duplicar o usuário.
 *
 * Usa `auth.api.signUpEmail`, a mesma API do Better Auth já validada em
 * `src/infrastructure/auth/auth.integration.test.ts` (Task 8) — não a
 * pseudocódigo original do brief.
 */
export default async function globalSetup(): Promise<void> {
  const { auth } = await import("../../src/infrastructure/auth/auth");
  const { prisma } = await import("../../src/infrastructure/db/prisma-client");

  try {
    const existing = await prisma.authUser.findUnique({ where: { email: ADMIN_EMAIL } });

    if (!existing) {
      await auth.api.signUpEmail({
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin" },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
