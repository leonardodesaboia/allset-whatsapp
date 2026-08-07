import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";
import { formatOpportunityMessage } from "../../domain/marketplace/opportunity-message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export async function notifyOpportunity(
  prisma: PrismaClient,
  input: { bookingId: string; now?: Date },
): Promise<{ notified: number }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + env.OPPORTUNITY_EXPIRY_HOURS * 60 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
    if (!booking) throw new Error(`Booking ${input.bookingId} não encontrado`);
    if (!booking.scheduledAt || !booking.neighborhood || booking.professionalPaymentCents == null) {
      throw new Error("Booking precisa de scheduledAt, neighborhood e professionalPaymentCents");
    }

    const opportunityInfo = {
      neighborhood: booking.neighborhood,
      scheduledAt: booking.scheduledAt,
      durationMinutes: booking.durationMinutes ?? 180,
    };

    const candidates = await tx.recruitmentLead.findMany({
      where: { status: { in: ["ATIVA", "PREFERENCIAL"] }, phoneE164: { not: null } },
      select: {
        id: true,
        status: true,
        neighborhood: true,
        canServeInitialArea: true,
        availabilityDays: true,
        phoneE164: true,
        opportunityResponses: {
          where: { response: "ACCEPTED" },
          include: { opportunity: { select: { scheduledAt: true } } },
        },
      },
    });

    const eligible = candidates.filter((lead) => {
      const acceptedSlotDates = lead.opportunityResponses.map((r) => r.opportunity.scheduledAt);
      return isEligibleForOpportunity(lead, opportunityInfo, acceptedSlotDates);
    });

    const opportunity = await tx.serviceOpportunity.create({
      data: {
        bookingId: booking.id,
        neighborhood: booking.neighborhood,
        scheduledAt: booking.scheduledAt,
        durationMinutes: booking.durationMinutes ?? 180,
        paymentCents: booking.professionalPaymentCents,
        expiresAt,
        status: "OPEN",
      },
    });

    const messageText = formatOpportunityMessage({
      neighborhood: opportunity.neighborhood,
      scheduledAt: opportunity.scheduledAt,
      durationMinutes: opportunity.durationMinutes,
      paymentCents: opportunity.paymentCents,
      expiresAt: opportunity.expiresAt,
    });

    for (const lead of eligible) {
      await tx.opportunityResponse.create({
        data: { opportunityId: opportunity.id, leadId: lead.id },
      });
      await enqueueOutboundMessage(tx, {
        provider: "evolution",
        recipient: lead.phoneE164!,
        payload: { version: 1, type: "TEXT", text: messageText },
        idempotencyKey: `opportunity:${opportunity.id}:${lead.id}:offer`,
        correlationId: opportunity.id,
        actor: "system:marketplace",
      });
    }

    const updated = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { status: "MATCHING", version: { increment: 1 } },
    });
    if (!updated.count) throw new Error("Booking alterado concorrentemente");

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "MATCHING",
        actor: "system:marketplace",
      },
    });

    await recordAuditLog(tx, {
      actor: "system:marketplace",
      action: "OPPORTUNITY_DISPATCHED",
      entityType: "ServiceOpportunity",
      entityId: opportunity.id,
      metadata: { bookingId: booking.id, eligible: eligible.length },
    });

    return { notified: eligible.length };
  });
}
