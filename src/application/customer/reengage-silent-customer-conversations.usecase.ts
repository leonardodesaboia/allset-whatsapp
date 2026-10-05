import type { PrismaClient } from "@prisma/client";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

export const activeStates = [
  "NAME",
  "PROPERTY_CHARACTERISTICS",
  "SCHEDULE_DATE",
  "SCHEDULE_TIME",
  "QUOTE_ACCEPTANCE",
  "ADDRESS",
  "FINAL_CONFIRMATION",
  "EDIT_SELECTION",
] as const;

/** Sends one recoverable reminder for each unanswered customer step. A new
 * inbound message creates a new idempotency key and therefore a new chance. */
export async function reengageSilentCustomerConversations(
  prisma: PrismaClient,
  input: {
    afterHours: number;
    limit?: number;
    now?: Date;
    conversationId?: string;
  }
): Promise<{ scanned: number; reengaged: number }> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.afterHours * 60 * 60 * 1000);
  const candidates = await prisma.customerBookingConversation.findMany({
    where: {
      state: { in: [...activeStates] },
      ...(input.conversationId ? { id: input.conversationId } : {}),
      lastInboundAt: { lte: cutoff },
      OR: [
        { lastReengagementAt: null },
        {
          lastReengagementAt: {
            lt: prisma.customerBookingConversation.fields.lastInboundAt,
          },
        },
      ],
    },
    include: { customer: { select: { phoneE164: true } } },
    orderBy: { lastInboundAt: "asc" },
    take: Math.min(Math.max(input.limit ?? 25, 1), 100),
  });
  let reengaged = 0;
  for (const conversation of candidates) {
    if (!conversation.lastInboundAt) continue;
    const key = `customer-reengagement:${conversation.id}:${conversation.lastInboundAt.getTime()}`;
    const sent = await prisma.$transaction(async (tx) => {
      const existing = await tx.outboxMessage.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      // Claim the exact snapshot: a reply, pause or completed request must win
      // over a reminder selected by an earlier read.
      const claimed = await tx.customerBookingConversation.updateMany({
        where: {
          id: conversation.id,
          version: conversation.version,
          state: conversation.state,
          lastInboundAt: conversation.lastInboundAt,
        },
        data: { lastReengagementAt: now, version: { increment: 1 } },
      });
      if (!claimed.count || existing) return false;
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: conversation.customer.phoneE164,
        payload: textPayload(
          "Oi! Seu pedido ficou pela metade. Quando quiser continuar, responda MENU e retomamos de onde paramos."
        ),
        idempotencyKey: key,
        correlationId: conversation.id,
        actor: "system:customer-reengagement",
      });
      return true;
    });
    if (sent) reengaged += 1;
  }
  return { scanned: candidates.length, reengaged };
}
