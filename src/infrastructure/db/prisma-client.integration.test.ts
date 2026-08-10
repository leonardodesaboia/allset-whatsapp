import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import type { PrismaClient } from "@prisma/client";

describe("prisma migrations", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => {
    await stop();
  });

  it("cria e lê um User depois de aplicar as migrations", async () => {
    const user = await prisma.user.create({
      data: { role: "ADMIN", fullName: "Admin Teste", phoneE164: "+5585999990000" },
    });
    const found = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(found.role).toBe("ADMIN");
  });
});
