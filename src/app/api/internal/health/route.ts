import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";

export const runtime = "nodejs";

/** Readiness probe for the deployment monitor; never exposes configuration or database details. */
export async function GET(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "Readiness check do banco falhou");
    return Response.json({ ok: false, error: "UNAVAILABLE" }, { status: 503 });
  }
}
