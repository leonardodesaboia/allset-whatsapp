import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";

describe("Better Auth — login de admin", () => {
  let stop: () => Promise<void>;
  let databaseUrl: string;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const db = await startTestDatabase();
    stop = db.stop;
    prisma = db.prisma;
    databaseUrl = db.container.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
  }, 60_000);

  afterAll(async () => stop());

  /** Importa o módulo já com DATABASE_URL apontando para o container. */
  async function getAuth() {
    const { auth } = await import("./auth");
    return auth;
  }

  async function loginAttemptsFor(email: string) {
    return prisma.auditLog.findMany({
      where: { action: "ADMIN_LOGIN_ATTEMPT", entityId: email },
      orderBy: { createdAt: "asc" },
    });
  }

  it("cria conta, faz login com senha correta e rejeita senha errada", async () => {
    const auth = await getAuth();

    const signUp = await auth.api.signUpEmail({
      body: { email: "admin@allset.test", password: "senha-super-segura-1", name: "Admin" },
    });
    expect(signUp.user.email).toBe("admin@allset.test");

    const signIn = await auth.api.signInEmail({
      body: { email: "admin@allset.test", password: "senha-super-segura-1" },
    });
    expect(signIn.user.email).toBe("admin@allset.test");

    await expect(
      auth.api.signInEmail({
        body: { email: "admin@allset.test", password: "senha-errada" },
      }),
    ).rejects.toThrow();
  });

  it("audita um login bem-sucedido em AuditLog com success: true", async () => {
    const auth = await getAuth();
    const email = "audit-ok@allset.test";

    await auth.api.signUpEmail({
      body: { email, password: "senha-super-segura-1", name: "Audit OK" },
    });
    // O sign-up não deve gerar auditoria de login: o hook filtra
    // explicitamente por ctx.path === "/sign-in/email".
    expect(await loginAttemptsFor(email)).toHaveLength(0);

    await auth.api.signInEmail({ body: { email, password: "senha-super-segura-1" } });

    const rows = await loginAttemptsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: email,
      action: "ADMIN_LOGIN_ATTEMPT",
      entityType: "AuthUser",
      entityId: email,
    });
    expect(rows[0]?.metadata).toEqual({ success: true });
  });

  it("audita um login malsucedido em AuditLog com success: false", async () => {
    const auth = await getAuth();
    const email = "audit-fail@allset.test";

    await auth.api.signUpEmail({
      body: { email, password: "senha-super-segura-1", name: "Audit Fail" },
    });

    await expect(
      auth.api.signInEmail({ body: { email, password: "senha-totalmente-errada" } }),
    ).rejects.toThrow();

    const rows = await loginAttemptsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ success: false });
  });

  it("audita tentativa de login para e-mail inexistente", async () => {
    const auth = await getAuth();
    const email = "nao-existe@allset.test";

    await expect(
      auth.api.signInEmail({ body: { email, password: "senha-super-segura-1" } }),
    ).rejects.toThrow();

    const rows = await loginAttemptsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ success: false });
  });

  // O rate limit do Better Auth atua na camada HTTP (`auth.handler`), não nas
  // chamadas diretas `auth.api.*` usadas nos testes acima — por isso este
  // teste monta Requests de verdade. Usa um IP próprio via `x-forwarded-for`
  // para não compartilhar o bucket do limiter com os outros testes.
  it("aplica rate limit em tentativas rápidas de login pelo handler HTTP", async () => {
    const auth = await getAuth();

    async function attemptViaHandler(): Promise<number> {
      const response = await auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.9",
          },
          body: JSON.stringify({
            email: "rate-limit@allset.test",
            password: "senha-super-segura-1",
          }),
        }),
      );
      return response.status;
    }

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push(await attemptViaHandler());
    }

    // A primeira tentativa passa pelo limiter (falha por credencial, não por
    // limite) e alguma das seguintes é barrada com 429.
    expect(statuses[0]).not.toBe(429);
    expect(statuses).toContain(429);
  });
});
