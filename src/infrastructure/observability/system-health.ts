import type { PrismaClient } from "@prisma/client";

export interface SystemHealthCheck {
  ok: boolean;
  database: "ok" | "unavailable";
  redis: "ok" | "unavailable" | "not_configured";
  outbox: { pending: number; deadLetter: number };
}

type HealthPrisma = Pick<PrismaClient, "$queryRaw" | "outboxMessage">;

/** Readiness check beyond "database reachable": also reports Redis (the job
 * queue depends on it) and the outbox backlog, so a stalled worker or a
 * growing dead-letter pile shows up here instead of only in the admin dashboard. */
export async function checkSystemHealth(
  prisma: HealthPrisma,
  deps: { redisConfigured: boolean; pingRedis: () => Promise<boolean> }
): Promise<SystemHealthCheck> {
  const database = await prisma.$queryRaw`SELECT 1`
    .then(() => "ok" as const)
    .catch(() => "unavailable" as const);

  const redis = !deps.redisConfigured
    ? ("not_configured" as const)
    : await deps
        .pingRedis()
        .then((reachable) =>
          reachable ? ("ok" as const) : ("unavailable" as const)
        )
        .catch(() => "unavailable" as const);

  const [pending, deadLetter] = await Promise.all([
    prisma.outboxMessage.count({
      where: { status: { in: ["PENDING", "FAILED"] } },
    }),
    prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } }),
  ]);

  return {
    ok: database === "ok" && redis !== "unavailable",
    database,
    redis,
    outbox: { pending, deadLetter },
  };
}
