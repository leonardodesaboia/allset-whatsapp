import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { env } from "@/env";
import { prisma } from "@/infrastructure/db/prisma-client";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import { logger } from "@/infrastructure/observability/logger";

export const runtime = "nodejs";

/** Endpoint exclusivo de worker/cron; o segredo vai em `x-allset-job-secret`. */
export async function POST(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const message = await dispatchNextOutboxMessage(prisma, createMessagingGatewayRegistry(), "system:outbox-worker");
    return Response.json({ ok: true, dispatched: Boolean(message), ...(message ? { messageId: message.id, status: message.status } : {}) });
  } catch (error) {
    logger.error({ err: error }, "Falha ao despachar outbox");
    return Response.json({ ok: false, error: "DISPATCH_FAILED" }, { status: 500 });
  }
}
