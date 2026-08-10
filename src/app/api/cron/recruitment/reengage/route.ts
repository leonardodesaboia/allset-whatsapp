import { reengageSilentConversations } from "@/application/recruitment/reengage-silent-conversations.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const result = await reengageSilentConversations(prisma, {
      afterHours: env.RECRUITMENT_REENGAGEMENT_AFTER_HOURS,
      maximumAttempts: env.RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error }, "Falha ao reengajar conversas silenciosas no cron");
    return Response.json({ ok: false, error: "REENGAGEMENT_FAILED" }, { status: 500 });
  }
}
