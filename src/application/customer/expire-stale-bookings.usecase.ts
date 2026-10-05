import type { PrismaClient, PropertyPricingTier } from "@prisma/client";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { env } from "../../env";

function buildReminderText(tier: PropertyPricingTier | null): string {
  const lines = ["⏰ Lembrete: seu pedido ainda aguarda pagamento."];
  if (env.PIX_KEY) lines.push(`\n🔑 Chave PIX: ${env.PIX_KEY}`);
  if (tier) lines.push(`💰 Valor: R$ ${(tier.priceCents / 100).toFixed(2).replace(".", ",")}`);
  lines.push("\nRealize o pagamento para confirmar seu agendamento. O pedido será cancelado automaticamente se o pagamento não for realizado.");
  return lines.join("\n");
}

const REMINDER_MS = 12 * 60 * 60 * 1000;
const CANCEL_MS = 24 * 60 * 60 * 1000;

export async function expireStaleBookings(prisma: PrismaClient): Promise<{
  reminders: number;
  cancelled: number;
  skipped: number;
  errors: Array<{ bookingId: string; error: unknown }>;
}> {
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() - REMINDER_MS);
  const cancelThreshold = new Date(now.getTime() - CANCEL_MS);

  const staleBookings = await prisma.booking.findMany({
    where: { status: "AWAITING_PAYMENT", updatedAt: { lt: reminderThreshold } },
    include: {
      customer: { select: { phoneE164: true } },
      customerConversation: true,
      propertyPricingTier: true,
    },
  });

  const results = { reminders: 0, cancelled: 0, skipped: 0, errors: [] as Array<{ bookingId: string; error: unknown }> };

  for (const booking of staleBookings) {
    const phoneE164 = booking.customer.phoneE164;
    const conversation = booking.customerConversation;

    if (!phoneE164 || !conversation || conversation.state !== "AWAITING_PAYMENT") {
      results.skipped++;
      continue;
    }

    const shouldCancel = booking.updatedAt < cancelThreshold;

    try {
      if (shouldCancel) {
        let didCancel = false;
        await prisma.$transaction(async (tx) => {
          const transition = await transitionBookingStatusInTransaction(tx, {
            bookingId: booking.id,
            targetStatus: "CANCELLED",
            actor: "system:booking-expiry",
            reason: "Pagamento não realizado em 24 horas",
          });
          if (!transition.ok) return;
          didCancel = true;

          await tx.customerBookingConversation.updateMany({
            where: { id: conversation.id, state: "AWAITING_PAYMENT" },
            data: { state: "COMPLETED", version: { increment: 1 } },
          });

          await enqueueOutboundMessage(tx, {
            provider: conversation.provider,
            recipient: phoneE164,
            payload: textPayload(
              "Seu pedido foi cancelado pois o pagamento não foi realizado dentro do prazo de 24 horas. " +
              "Para fazer um novo agendamento, basta nos enviar uma mensagem."
            ),
            idempotencyKey: `payment-cancelled:${conversation.id}`,
            correlationId: conversation.id,
            actor: "system:booking-expiry",
          });
        });
        if (didCancel) results.cancelled++;
        else results.skipped++;
      } else {
        await enqueueOutboundMessage(prisma, {
          provider: conversation.provider,
          recipient: phoneE164,
          payload: textPayload(buildReminderText(booking.propertyPricingTier)),
          idempotencyKey: `payment-reminder:${conversation.id}`,
          correlationId: conversation.id,
          actor: "system:booking-expiry",
        });
        results.reminders++;
      }
    } catch (error) {
      results.errors.push({ bookingId: booking.id, error });
    }
  }

  return results;
}
