import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";

describe("Better Auth — login de admin", () => {
  let stop: () => Promise<void>;
  let databaseUrl: string;

  beforeAll(async () => {
    const db = await startTestDatabase();
    stop = db.stop;
    databaseUrl = db.container.getConnectionUri();
    process.env.DATABASE_URL = databaseUrl;
  }, 60_000);

  afterAll(async () => stop());

  it("cria conta, faz login com senha correta e rejeita senha errada", async () => {
    const { auth } = await import("./auth");

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
});
