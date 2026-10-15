import type { PrismaClient } from "@prisma/client";
import type { MessagingGatewayRegistry } from "../../domain/ports/messaging-gateway";
import { dispatchNextOutboxMessage } from "../../application/messaging/dispatch-outbox.usecase";
import { logger } from "../observability/logger";

/** Every attempt uses the application's atomic lease; failed rows back off and do not block newer replies. */
export async function drainOutbox(prisma: PrismaClient, registry: MessagingGatewayRegistry, input: { actor: string; limit: number }) {
  let dispatched = 0;
  while (dispatched < input.limit) {
    const result = await dispatchNextOutboxMessage(prisma, registry, input.actor);
    if (!result) break;
    dispatched++;
    if (result.status === "FAILED" || result.status === "DEAD_LETTER") {
      const providerError = (result.lastError ?? "Unknown send error").replace(/\d{8,}/g, (phone) => `***${phone.slice(-4)}`).slice(0, 500);
      const details = {
        outboxMessageId: result.id, provider: result.provider,
        recipient: `***${result.recipient.replace(/\D/g, "").slice(-4)}`,
        status: result.status, httpStatus: Number(providerError.match(/HTTP (\d{3})/)?.[1]) || null,
        providerError, actor: input.actor,
      };
      if (result.status === "DEAD_LETTER") logger.error(details, "Outbox delivery exhausted retries");
      else logger.warn(details, "Outbox delivery failed; retry scheduled");
    }
  }
  return dispatched;
}
