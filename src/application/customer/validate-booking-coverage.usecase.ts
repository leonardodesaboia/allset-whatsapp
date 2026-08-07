import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

const inputSchema = z.object({
  bookingId: z.string().uuid(),
  isCovered: z.boolean(),
  actor: z.string().trim().min(1).max(160),
});

function paymentConfirmationText(totalCents: number): string {
  return [
    "Endereço validado para atendimento.",
    "",
    `Valor da limpeza: R$ ${(totalCents / 100).toFixed(2).replace(".", ",")}`,
    "",
    "Podemos seguir para o pagamento?",
    "",
    "1 — Confirmar e pagar",
    "2 — Alterar informações",
  ].join("\n");
}

export async function validateCustomerBookingCoverage(
  prisma: PrismaClient,
  rawInput: { bookingId: string; isCovered: boolean; actor: string },
) {
  const input = inputSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { customerConversation: true, customer: { select: { phoneE164: true } } },
    });
    if (!booking) return { ok: false as const, reason: "BOOKING_NOT_FOUND" as const };
    if (booking.status !== "REVIEW_REQUIRED" || !booking.customerConversation) {
      return { ok: false as const, reason: "BOOKING_NOT_AWAITING_COVERAGE" as const };
    }

    if (!input.isCovered) {
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
      data: { state: "FINAL_CONFIRMATION", lastQuestionKey: "FINAL_CONFIRMATION", lastInboundAt: new Date(), version: { increment: 1 } },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { coverageValidatedAt: new Date(), outsideCoverageArea: false } });
    await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient: booking.customer.phoneE164,
      payload: textPayload(paymentConfirmationText(booking.totalCents)),
      idempotencyKey: `customer-booking:${conversation.id}:FINAL_CONFIRMATION:${conversation.updatedAt.getTime()}`,
      correlationId: conversation.id,
      actor: input.actor,
    });
    return { ok: true as const, covered: true as const };
  });
}
