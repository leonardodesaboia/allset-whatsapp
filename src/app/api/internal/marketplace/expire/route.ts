import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { env } from "@/env";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";

export const runtime = "nodejs";

/** Cron-only endpoint for opportunities whose response deadline has elapsed. */
export async function POST(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const result = await expireOpportunities(prisma);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error }, "Falha ao expirar oportunidades");
    return Response.json({ ok: false, error: "EXPIRE_FAILED" }, { status: 500 });
  }
}
