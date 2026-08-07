import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { textPayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

const inputSchema = z.object({
  bookingId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  text: z.string().trim().min(1).max(2_000),
  actor: z.string().trim().min(1).max(160),
}).refine((input) => Boolean(input.bookingId || input.conversationId), { message: "Informe uma conversa ou pedido." });

/** Any manual admin message pauses automatic customer prompts until an explicit resume. */
export async function sendManualCustomerMessage(
  prisma: PrismaClient,
  rawInput: { bookingId?: string; conversationId?: string; text: string; actor: string },
) {
  const input = inputSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const conversationWithCustomer = input.conversationId
      ? await tx.customerBookingConversation.findUnique({ where: { id: input.conversationId }, include: { customer: { select: { phoneE164: true } }, booking: { select: { id: true } } } })
      : input.bookingId
        ? await tx.customerBookingConversation.findUnique({ where: { bookingId: input.bookingId }, include: { customer: { select: { phoneE164: true } }, booking: { select: { id: true } } } })
        : null;
    if (!conversationWithCustomer) return { ok: false as const, reason: "CUSTOMER_CONVERSATION_NOT_FOUND" as const };

    const conversation = await tx.customerBookingConversation.update({
      where: { id: conversationWithCustomer.id },
      data: { state: "PAUSED", automationPausedAt: new Date(), version: { increment: 1 } },
    });
    await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient: conversationWithCustomer.customer.phoneE164,
      payload: textPayload(input.text),
      idempotencyKey: `customer-booking:${conversation.id}:manual:${conversation.updatedAt.getTime()}`,
      correlationId: conversation.id,
      actor: input.actor,
    });
    await recordAuditLog(tx, {
      actor: input.actor,
      action: "CUSTOMER_CONVERSATION_PAUSED_BY_MANUAL_MESSAGE",
      entityType: "CustomerBookingConversation",
      entityId: conversation.id,
      metadata: { bookingId: conversationWithCustomer.booking?.id ?? input.bookingId ?? null },
    });
    return { ok: true as const, conversationId: conversation.id };
  });
}
