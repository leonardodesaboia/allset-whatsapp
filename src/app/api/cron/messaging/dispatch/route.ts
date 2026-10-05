import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";

export const runtime = "nodejs";

// Evolution calls may each take seconds. Keep cron invocations below typical
// serverless time limits; the next minute continues draining the outbox.
const batchLimit = 10;

export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  const registry = createMessagingGatewayRegistry();
  let dispatched = 0;
  try {
    while (dispatched < batchLimit) {
      const result = await dispatchNextOutboxMessage(prisma, registry);
      if (!result) break;
      dispatched += 1;
    }
    return Response.json({ ok: true, dispatched });
  } catch (error) {
    logger.error({ err: error, dispatched }, "Falha ao drenar outbox no cron");
    return Response.json({ ok: false, error: "DISPATCH_FAILED", dispatched }, { status: 500 });
  }
}
