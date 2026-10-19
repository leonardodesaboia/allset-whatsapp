import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../../env";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";
import { formatOpportunityMessage } from "../../domain/marketplace/opportunity-message";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { transitionBookingStatus } from "../../domain/booking/booking-state-machine";
import type { BookingStatus } from "../../domain/booking/booking-status";

export type NotifyOpportunityResult = {
  notified: number;
  dispatched: boolean;
  opportunityId?: string;
};

export async function notifyOpportunity(
  prisma: PrismaClient,
  input: { bookingId: string; now?: Date; actor?: string }
): Promise<NotifyOpportunityResult> {
  return prisma.$transaction((tx) => notifyOpportunityInTransaction(tx, input));
}

/**
 * Creates the opportunity and offers it to eligible professionals. Runs inside
 * the caller's transaction so a WhatsApp conversation can hand the booking to
 * matching atomically with its own state change.
 */
export async function notifyOpportunityInTransaction(
  tx: Prisma.TransactionClient,
  input: { bookingId: string; now?: Date; actor?: string }
): Promise<NotifyOpportunityResult> {
  const now = input.now ?? new Date();
  const actor = input.actor ?? "system:marketplace";
  const expiresAt = new Date(
    now.getTime() + env.OPPORTUNITY_EXPIRY_HOURS * 60 * 60 * 1000
  );

  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    include: {
      customer: { select: { phoneE164: true } },
      customerConversation: { select: { provider: true } },
    },
  });
  if (!booking) throw new Error(`Booking ${input.bookingId} não encontrado`);
  // Sem pagamento pela plataforma: o valor é opcional (pedidos antigos com
  // faixa de imóvel ainda o mostram); o valor final é combinado direto.
  const estimatedValueCents =
    booking.professionalPaymentCents ?? (booking.totalCents > 0 ? booking.totalCents : null);
  if (!booking.scheduledAt || !booking.neighborhood) {
    throw new Error("Booking precisa de scheduledAt e neighborhood");
  }

  const opportunityInfo = {
    neighborhood: booking.neighborhood,
    scheduledAt: booking.scheduledAt,
    durationMinutes: booking.durationMinutes ?? 180,
  };

  const candidates = await tx.recruitmentLead.findMany({
    where: {
      status: { in: ["ATIVA", "PREFERENCIAL"] },
      phoneE164: { not: null },
    },
    select: {
      id: true,
      status: true,
      neighborhood: true,
      canServeInitialArea: true,
      availabilityDays: true,
      phoneE164: true,
      conversation: { select: { provider: true } },
      opportunityResponses: {
        where: { response: "ACCEPTED" },
        include: { opportunity: { select: { scheduledAt: true } } },
      },
    },
  });

  const eligible = candidates.filter((lead) => {
    const acceptedSlotDates = lead.opportunityResponses.map(
      (r) => r.opportunity.scheduledAt
    );
    return isEligibleForOpportunity(lead, opportunityInfo, acceptedSlotDates);
  });

  // A booking in MATCHING without a recipient is operationally invisible: no
  // professional can accept it and the admin has no reliable recovery path.
  // Keep the booking in its current state until there is at least one real
  // candidate to notify.
  if (eligible.length === 0) {
    if (booking.customer.phoneE164) {
      await enqueueOutboundMessage(tx, {
        provider:
          booking.customerConversation?.provider ??
          env.MESSAGING_DEFAULT_PROVIDER,
        recipient: booking.customer.phoneE164,
        payload: textPayload(
          "Ainda estamos buscando uma profissional disponível para o seu atendimento. Pode levar algumas horas; avisaremos por aqui assim que confirmarmos."
        ),
        idempotencyKey: `opportunity:${booking.id}:no-candidates:${booking.updatedAt.getTime()}`,
        correlationId: booking.id,
        actor,
      });
    }
    await recordAuditLog(tx, {
      actor,
      action: "OPPORTUNITY_NOT_DISPATCHED",
      entityType: "Booking",
      entityId: booking.id,
      metadata: { reason: "NO_ELIGIBLE_CANDIDATES" },
    });
    return { notified: 0, dispatched: false };
  }

  const transition = transitionBookingStatus(
    booking.status as BookingStatus,
    "MATCHING"
  );
  if (!transition.ok) throw new Error(transition.error.message);

  // Claim the status before creating the opportunity. The compare-and-set
  // makes two simultaneous admin retries harmless: only one transaction can
  // enter MATCHING and create an open opportunity.
  const updated = await tx.booking.updateMany({
    where: {
      id: booking.id,
      status: booking.status,
      version: booking.version,
    },
    data: { status: "MATCHING", version: { increment: 1 } },
  });
  if (!updated.count) throw new Error("Booking alterado concorrentemente");

  const opportunity = await tx.serviceOpportunity.create({
    data: {
      bookingId: booking.id,
      neighborhood: booking.neighborhood,
      scheduledAt: booking.scheduledAt,
      durationMinutes: booking.durationMinutes ?? 180,
      // 0 = sem valor estimado; o valor é combinado direto com o cliente.
      paymentCents: estimatedValueCents ?? 0,
      expiresAt,
      status: "OPEN",
    },
  });

  for (const lead of eligible) {
    const responseToken = randomUUID()
      .replaceAll("-", "")
      .slice(0, 10)
      .toUpperCase();
    await tx.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead.id, responseToken },
    });
    const messageText = formatOpportunityMessage({
      neighborhood: opportunity.neighborhood,
      scheduledAt: opportunity.scheduledAt,
      durationMinutes: booking.durationMinutes,
      paymentCents: opportunity.paymentCents,
      serviceDetails: booking.customerNotes,
      expiresAt: opportunity.expiresAt,
      responseToken,
    });
    await enqueueOutboundMessage(tx, {
      provider: lead.conversation?.provider ?? env.MESSAGING_DEFAULT_PROVIDER,
      recipient: lead.phoneE164!,
      payload: { version: 1, type: "TEXT", text: messageText },
      idempotencyKey: `opportunity:${opportunity.id}:${lead.id}:offer`,
      correlationId: opportunity.id,
      actor,
    });
  }

  await tx.bookingStatusHistory.create({
    data: {
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: "MATCHING",
      actor,
    },
  });

  await recordAuditLog(tx, {
    actor,
    action: "OPPORTUNITY_DISPATCHED",
    entityType: "ServiceOpportunity",
    entityId: opportunity.id,
    metadata: { bookingId: booking.id, eligible: eligible.length },
  });

  return { notified: eligible.length, dispatched: true, opportunityId: opportunity.id };
}
