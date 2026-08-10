import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export async function startTestDatabase(): Promise<{
  container: StartedPostgreSqlContainer;
  prisma: PrismaClient;
  stop: () => Promise<void>;
}> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = container.getConnectionUri();

  try {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
  } catch (error) {
    await container.stop();
    throw error;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  return {
    container,
    prisma,
    stop: async () => {
      try {
        await prisma.$disconnect();
      } finally {
        await container.stop();
      }
    },
  };
}
