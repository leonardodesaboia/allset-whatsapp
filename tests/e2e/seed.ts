import dotenv from "dotenv";
import { execFile } from "node:child_process";
import path from "path";
import { promisify } from "node:util";

// globalSetup roda em um processo Node separado do webServer do Playwright
// (que é o próprio Next.js, e carrega .env sozinho) — precisamos carregar o
// .env manualmente aqui, mesmo padrão usado em vitest.setup.ts.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

const ADMIN_EMAIL = "admin@allset.test";
const ADMIN_PASSWORD = "senha-super-segura-1";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const execFileAsync = promisify(execFile);

/**
 * Trava de segurança: este seed grava uma credencial de admin *conhecida
 * publicamente* (está aqui no código-fonte). Ele só pode rodar contra um
 * banco local e fora de produção — caso contrário, aborta antes de tocar
 * no banco.
 */
function assertSafeSeedTarget(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Seed de E2E bloqueado: NODE_ENV=production. Este seed grava uma credencial " +
        "de admin conhecida e nunca deve rodar em produção.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Seed de E2E bloqueado: DATABASE_URL não está definida.");
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Seed de E2E bloqueado: DATABASE_URL não é uma URL válida.");
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Seed de E2E bloqueado: DATABASE_URL aponta para o host "${hostname}", que não é ` +
        "local. Este seed só pode rodar contra localhost/127.0.0.1.",
    );
  }
}

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
  assertSafeSeedTarget();

  // E2E uses the local development database rather than a disposable
  // Testcontainer. Apply every checked-in migration before starting Next so
  // Prisma's generated enum values cannot get ahead of PostgreSQL's enum.
  await execFileAsync("pnpm", ["prisma", "migrate", "deploy"], {
    cwd: path.resolve(import.meta.dirname, "../.."),
  });

  const { auth } = await import("../../src/infrastructure/auth/auth");
  const { prisma } = await import("../../src/infrastructure/db/prisma-client");

  try {
    const existing = await prisma.authUser.findUnique({ where: { email: ADMIN_EMAIL } });

    if (!existing) {
      await auth.api.signUpEmail({
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: "Admin" },
      });
    }
    const domainAdmin = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      include: { adminProfile: true },
    });
    if (!domainAdmin) {
      const user = await prisma.user.create({ data: { role: "ADMIN", fullName: "Admin", email: ADMIN_EMAIL, phoneE164: "+5585990000000" } });
      await prisma.adminProfile.create({ data: { userId: user.id } });
    } else if (!domainAdmin.adminProfile) {
      await prisma.adminProfile.create({ data: { userId: domainAdmin.id } });
    }

    const seedPhone = "+5585990000001";
    const lead = await prisma.recruitmentLead.findFirst({ where: { phoneE164: seedPhone } });
    if (!lead) {
      await prisma.recruitmentLead.create({
        data: {
          origin: "INDICACAO_PROFISSIONAL",
          status: "PRE_CADASTRO",
          fullName: "Maria de Sousa",
          phoneE164: seedPhone,
          neighborhood: "Parangaba",
          preferredCommunicationMode: "AUDIO",
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}
