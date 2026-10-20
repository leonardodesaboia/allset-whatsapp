import type { OutboxMessage, PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { formatOpportunityMessage } from "../../domain/marketplace/opportunity-message";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";
import { textPayload } from "../../domain/messaging/message";
import { randomUUID } from "node:crypto";

/** Atualiza local público e prazo no momento do envio, inclusive em retries. */
export async function prepareOpportunityDelivery(
  prisma: PrismaClient,
  message: OutboxMessage
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ServiceOpportunity" WHERE id = ${message.correlationId} FOR UPDATE`;
    const opportunity = await tx.serviceOpportunity.findUnique({
      where: { id: message.correlationId! },
      include: {
        booking: {
          select: { neighborhood: true, customerNotes: true, durationMinutes: true },
        },
      },
    });
    const response = opportunity
      ? await tx.opportunityResponse.findFirst({
          where: {
            opportunityId: opportunity.id,
            lead: { phoneE164: message.recipient },
          },
          include: { lead: true },
        })
      : null;
    const owned = {
      id: message.id,
      status: "SENDING" as const,
      attempts: message.attempts,
      leaseExpiresAt: message.leaseExpiresAt,
    };
    if (
      !opportunity ||
      opportunity.status !== "OPEN" ||
      // Nunca oferecer um serviço cujo horário já passou.
      opportunity.scheduledAt <= new Date() ||
      !response ||
      response.response ||
      !isEligibleForOpportunity(response.lead)
    ) {
      await tx.outboxMessage.updateMany({
        where: owned,
        data: {
          status: "CANCELLED",
          leaseExpiresAt: null,
          lastError: "Proposta encerrada ou profissional indisponível",
        },
      });
      return null;
    }
    // O prazo começa no envio e nunca passa do horário do serviço.
    const expiresAt = new Date(
      Math.min(
        Date.now() + env.OPPORTUNITY_EXPIRY_HOURS * 60 * 60 * 1000,
        opportunity.scheduledAt.getTime()
      )
    );
    const responseToken =
      response.responseToken ??
      randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const payload = textPayload(
      formatOpportunityMessage({
        neighborhood:
          opportunity.booking.neighborhood?.trim() || "Bairro a confirmar",
        scheduledAt: opportunity.scheduledAt,
        durationMinutes: opportunity.booking.durationMinutes,
        paymentCents: opportunity.paymentCents,
        serviceDetails: opportunity.booking.customerNotes,
        expiresAt,
        responseToken,
      })
    );
    const updated = await tx.outboxMessage.updateMany({
      where: owned,
      data: { payload: { ...payload } },
    });
    if (!updated.count) return null;
    await tx.opportunityResponse.update({
      where: { id: response.id },
      data: { expiresAt, responseToken },
    });
    await tx.serviceOpportunity.updateMany({
      where: { id: opportunity.id, expiresAt: { lt: expiresAt } },
      data: { expiresAt },
    });
    return payload;
  });
}
