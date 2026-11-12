import type { OutboxMessage, PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { formatOpportunityMessage } from "../../domain/marketplace/opportunity-message";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";
import { textPayload, type TextMessagePayload } from "../../domain/messaging/message";

export interface PreparedOpportunityDelivery {
  payload: TextMessagePayload;
  /** Gravado só quando o provider confirma o envio: antes disso a proposta não vale. */
  delivery: { responseId: string; sentAt: Date; expiresAt: Date };
}

/** Atualiza local público e prazo no momento do envio, inclusive em retries. */
export async function prepareOpportunityDelivery(
  prisma: PrismaClient,
  message: OutboxMessage
): Promise<PreparedOpportunityDelivery | null> {
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
    // O prazo é individual, começa no envio e nunca passa do horário do serviço.
    // A próxima proposta da mesma profissional espera esta ser respondida,
    // encerrada ou vencer.
    const sentAt = new Date();
    const expiresAt = new Date(
      Math.min(
        sentAt.getTime() + env.OPPORTUNITY_RESPONSE_MINUTES * 60 * 1000,
        opportunity.scheduledAt.getTime()
      )
    );
    const payload = textPayload(
      formatOpportunityMessage({
        neighborhood:
          opportunity.booking.neighborhood?.trim() || "Bairro a confirmar",
        scheduledAt: opportunity.scheduledAt,
        durationMinutes: opportunity.booking.durationMinutes,
        paymentCents: opportunity.paymentCents,
        serviceDetails: opportunity.booking.customerNotes,
        expiresAt,
        sentAt,
      })
    );
    const updated = await tx.outboxMessage.updateMany({
      where: owned,
      data: { payload: { ...payload } },
    });
    if (!updated.count) return null;
    await tx.serviceOpportunity.updateMany({
      where: { id: opportunity.id, expiresAt: { lt: expiresAt } },
      data: { expiresAt },
    });
    return { payload, delivery: { responseId: response.id, sentAt, expiresAt } };
  });
}
