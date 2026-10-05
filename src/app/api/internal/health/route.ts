import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { checkSystemHealth } from "@/infrastructure/observability/system-health";
import { env } from "@/env";

export const runtime = "nodejs";

async function pingRedis(redisUrl: string): Promise<boolean> {
  const IORedis = (await import("ioredis")).default;
  const client = new IORedis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  try {
    return (await client.ping()) === "PONG";
  } finally {
    client.disconnect();
  }
}

/** Readiness probe for the deployment monitor; never exposes configuration or database details. */
export async function GET(request: Request) {
  if (
    !compareSecret(
      env.INTERNAL_JOB_SECRET,
      request.headers.get("x-allset-job-secret")
    )
  ) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await checkSystemHealth(prisma, {
    redisConfigured: Boolean(env.REDIS_URL),
    pingRedis: () => pingRedis(env.REDIS_URL!),
  });
  if (!result.ok)
    logger.error(
      { health: result },
      "Readiness check reportou indisponibilidade"
    );
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
