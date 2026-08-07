import { reengageSilentConversations } from "@/application/recruitment/reengage-silent-conversations.usecase";
import { env } from "@/env";
import { prisma } from "@/infrastructure/db/prisma-client";
import { isValidEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";
import { logger } from "@/infrastructure/observability/logger";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({ limit: z.number().int().min(1).max(100).optional() }).default({});

/** Cron-only: reenvia a pergunta pendente para pré-cadastros silenciosos. */
export async function POST(request: Request) {
  if (!isValidEvolutionWebhook(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    body = bodySchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return Response.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
  }
  try {
    const result = await reengageSilentConversations(prisma, {
      afterHours: env.RECRUITMENT_REENGAGEMENT_AFTER_HOURS,
      maximumAttempts: env.RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS,
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error }, "Falha ao reengajar conversas silenciosas");
    return Response.json({ ok: false, error: "REENGAGEMENT_FAILED" }, { status: 500 });
  }
}
