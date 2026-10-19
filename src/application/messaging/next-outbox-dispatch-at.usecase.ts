import type { PrismaClient } from "@prisma/client";
import { WHATSAPP_THROTTLE_KEY } from "./dispatch-outbox.usecase";

/** Considera o prazo efetivo de cada mensagem, sem bloquear a fila por uma lease. */
export async function getNextOutboxDispatchAt(
  prisma: PrismaClient
): Promise<Date | null> {
  const [result] = await prisma.$queryRaw<Array<{ nextAt: Date | null }>>`
    SELECT MIN(GREATEST(
      CASE WHEN message.status = 'SENDING' THEN message."leaseExpiresAt" ELSE message."availableAt" END,
      COALESCE(throttle."nextSendAt", '-infinity'::timestamp)
    )) AS "nextAt"
    FROM "OutboxMessage" message
    LEFT JOIN "MessagingDispatchThrottle" throttle
      ON throttle.provider = ${WHATSAPP_THROTTLE_KEY}
     AND message.provider IN ('evolution', 'whatsmiau')
    WHERE message.status IN ('PENDING', 'FAILED')
       OR (message.status = 'SENDING' AND message."leaseExpiresAt" IS NOT NULL)
  `;
  return result?.nextAt ?? null;
}
