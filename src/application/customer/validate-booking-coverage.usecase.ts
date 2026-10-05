import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { customerBookingSummary } from "../../domain/customer/customer-booking-summary";

const inputSchema = z.object({
  bookingId: z.string().uuid(),
  isCovered: z.boolean(),
  actor: z.string().trim().min(1).max(160),
});

export async function validateCustomerBookingCoverage(
  prisma: PrismaClient,
  rawInput: { bookingId: string; isCovered: boolean; actor: string },
) {
  const input = inputSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const owner = await tx.booking.findUnique({ where: { id: input.bookingId }, select: { customerId: true } });
    if (owner) await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.customerId} FOR UPDATE`;
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { customerConversation: true, customer: { select: { phoneE164: true } } },
    });
    if (!booking) return { ok: false as const, reason: "BOOKING_NOT_FOUND" as const };
    const awaitingCoverage = booking.customerConversation?.state === "MANUAL_REVIEW"
      || (booking.customerConversation?.state === "PAUSED" && booking.customerConversation.lastQuestionKey === "MANUAL_REVIEW");
    if (booking.status !== "REVIEW_REQUIRED" || !awaitingCoverage || !booking.customerConversation) {
      return { ok: false as const, reason: "BOOKING_NOT_AWAITING_COVERAGE" as const };
    }

    if (!input.isCovered) {
      const transition = await transitionBookingStatusInTransaction(tx, {
        bookingId: booking.id,
        targetStatus: "CANCELLED",
        actor: input.actor,
        reason: "Endereço fora da área de cobertura",
      });
      if (!transition.ok) throw transition.error;
      const conversation = await tx.customerBookingConversation.update({
        where: { id: booking.customerConversation.id },
        data: { state: "COMPLETED", lastQuestionKey: "COMPLETED", automationPausedAt: new Date(), version: { increment: 1 } },
      });
      await tx.booking.update({ where: { id: booking.id }, data: { outsideCoverageArea: true } });
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: booking.customer.phoneE164,
        payload: textPayload("Seu endereço ficou na nossa lista de espera. Se conseguirmos uma profissional para esta região, entraremos em contato."),
        idempotencyKey: `customer-booking:${conversation.id}:outside-coverage:${conversation.updatedAt.getTime()}`,
        correlationId: conversation.id,
        actor: input.actor,
      });
      return { ok: true as const, covered: false as const };
    }

    const transition = await transitionBookingStatusInTransaction(tx, {
      bookingId: booking.id,
      targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
      actor: input.actor,
      reason: "Cobertura validada manualmente",
    });
    if (!transition.ok) throw transition.error;
    const conversation = await tx.customerBookingConversation.update({
      where: { id: booking.customerConversation.id },
      data: {
        state: booking.customerConversation.state === "PAUSED" ? "PAUSED" : "FINAL_CONFIRMATION",
        lastQuestionKey: "FINAL_CONFIRMATION", lastInboundAt: new Date(), version: { increment: 1 },
      },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { coverageValidatedAt: new Date(), outsideCoverageArea: false } });
    if (conversation.state !== "PAUSED") await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient: booking.customer.phoneE164,
      payload: textPayload(`Endereço validado para atendimento.\n\n${customerBookingSummary(booking)}`),
      idempotencyKey: `customer-booking:${conversation.id}:FINAL_CONFIRMATION:${conversation.updatedAt.getTime()}`,
      correlationId: conversation.id,
      actor: input.actor,
    });
    return { ok: true as const, covered: true as const };
  });
}
