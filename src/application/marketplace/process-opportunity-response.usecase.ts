import type { Prisma, PrismaClient } from "@prisma/client";
import { transitionBookingStatus } from "../../domain/booking/booking-state-machine";
import type { BookingStatus } from "../../domain/booking/booking-status";
import { parseOpportunityReply } from "../../domain/marketplace/opportunity-reply";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

type Database = PrismaClient | Prisma.TransactionClient;

export type OpportunityResponseOutcome =
  | "ACCEPTED"
  | "DECLINED"
  | "ALREADY_FILLED"
  | "INVALID_RESPONSE"
  | "NOT_FOUND"
  | "DUPLICATE_INBOUND"
  | "AMBIGUOUS_RESPONSE";

function formatSchedule(scheduledAt: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Fortaleza",
  }).format(scheduledAt);
}

async function enqueueText(
  database: Database,
  input: { provider: string; recipient: string | null; text: string; idempotencyKey: string; correlationId: string },
): Promise<void> {
  if (!input.recipient) return;

  await enqueueOutboundMessage(database, {
    provider: input.provider,
    recipient: input.recipient,
    payload: { version: 1, type: "TEXT", text: input.text },
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    actor: "system:marketplace",
  });
}

/** Stops an ambiguous reply from falling into another conversation workflow. */
export async function requestOpportunityClarification(
  prisma: PrismaClient,
  input: { inboundMessageId: string; responseTokens: Array<string | null> },
): Promise<{ outcome: "AMBIGUOUS_RESPONSE" | "DUPLICATE_INBOUND" | "NOT_FOUND" }> {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundMessage.findUnique({
      where: { id: input.inboundMessageId },
      select: { id: true, provider: true, sender: true },
    });
    if (!inbound) return { outcome: "NOT_FOUND" as const };

    const claimed = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count) return { outcome: "DUPLICATE_INBOUND" as const };

    const codes = input.responseTokens.filter((token): token is string => token !== null).slice(0, 3);
    const text = codes.length > 0
      ? `Você tem mais de uma oportunidade em aberto. Responda SIM seguido do código da oportunidade: ${codes.join(", ")}.`
      : "Você tem mais de uma oportunidade em aberto. Consulte as mensagens anteriores ou peça ajuda para escolher a oportunidade.";
    await enqueueText(tx, {
      provider: inbound.provider,
      recipient: inbound.sender,
      text,
      idempotencyKey: `opportunity:clarification:${inbound.id}`,
      correlationId: inbound.id,
    });
    return { outcome: "AMBIGUOUS_RESPONSE" as const };
  });
}

/**
 * Resolves a response to a service opportunity. The inbound message is claimed
 * inside the same transaction, making provider retries safe and preserving the
 * first-acceptance-wins rule under concurrent responses.
 */
export async function processOpportunityResponse(
  prisma: PrismaClient,
  input: { responseId: string; text: string; inboundMessageId: string },
): Promise<{ outcome: OpportunityResponseOutcome }> {
  return prisma.$transaction(async (tx) => {
    const response = await tx.opportunityResponse.findUnique({
      where: { id: input.responseId },
      include: {
        opportunity: true,
        lead: { select: { id: true, fullName: true, phoneE164: true, conversation: { select: { provider: true } } } },
      },
    });
    if (!response) return { outcome: "NOT_FOUND" as const };

    const inbound = await tx.inboundMessage.findUnique({
      where: { id: input.inboundMessageId },
      select: { id: true, sender: true, provider: true, processedAt: true },
    });
    // A response id must never be usable by a different WhatsApp number.
    if (!inbound || inbound.sender !== response.lead.phoneE164) {
      return { outcome: "NOT_FOUND" as const };
    }

    const claimedInbound = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimedInbound.count) return { outcome: "DUPLICATE_INBOUND" as const };

    if (response.response !== null || response.opportunity.status !== "OPEN") {
      return { outcome: "ALREADY_FILLED" as const };
    }

    const parsed = parseOpportunityReply(input.text)?.response;
    if (!parsed) return { outcome: "INVALID_RESPONSE" as const };

    const now = new Date();
    const { opportunity, lead } = response;

    if (parsed === "DECLINED") {
      const declined = await tx.opportunityResponse.updateMany({
        where: { id: response.id, response: null },
        data: { response: "DECLINED", respondedAt: now },
      });
      if (!declined.count) return { outcome: "ALREADY_FILLED" as const };

      await enqueueText(tx, {
        provider: inbound.provider,
        recipient: lead.phoneE164,
        text: "Tudo bem, obrigado! Avisaremos quando surgir uma nova oportunidade.",
        idempotencyKey: `opportunity:${opportunity.id}:${response.id}:declined`,
        correlationId: opportunity.id,
      });
      await recordAuditLog(tx, {
        actor: "system:marketplace",
        action: "OPPORTUNITY_DECLINED",
        entityType: "OpportunityResponse",
        entityId: response.id,
        metadata: { opportunityId: opportunity.id, leadId: lead.id },
      });
      return { outcome: "DECLINED" as const };
    }

    // OPEN -> FILLED is the atomic first-acceptance-wins lock.
    const claimedOpportunity = await tx.serviceOpportunity.updateMany({
      where: { id: opportunity.id, status: "OPEN", expiresAt: { gt: now } },
      data: { status: "FILLED" },
    });
    if (!claimedOpportunity.count) {
      await enqueueText(tx, {
        provider: lead.conversation?.provider ?? inbound.provider,
        recipient: lead.phoneE164,
        text: "Esta oportunidade já foi preenchida. Avisaremos quando surgir uma nova.",
        idempotencyKey: `opportunity:${opportunity.id}:${response.id}:too-late`,
        correlationId: opportunity.id,
      });
      return { outcome: "ALREADY_FILLED" as const };
    }

    const booking = await tx.booking.findUniqueOrThrow({ where: { id: opportunity.bookingId } });
    const transition = transitionBookingStatus(
      booking.status as BookingStatus,
      "PROFESSIONAL_ASSIGNED",
    );
    if (!transition.ok) throw new Error(transition.error.message);

    const updatedBooking = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: {
        status: "PROFESSIONAL_ASSIGNED",
        assignedProfessionalLeadId: lead.id,
        version: { increment: 1 },
      },
    });
    // Throwing rolls back the opportunity lock too; a retry can safely resolve it.
    if (!updatedBooking.count) throw new Error("Booking alterado concorrentemente");

    await tx.opportunityResponse.update({
      where: { id: response.id },
      data: { response: "ACCEPTED", respondedAt: now },
    });
    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: "PROFESSIONAL_ASSIGNED",
        actor: "system:marketplace",
        reason: `Aceito por ${lead.fullName ?? "profissional"}`,
      },
    });

    await enqueueText(tx, {
      provider: inbound.provider,
      recipient: lead.phoneE164,
      text: `Confirmado${lead.fullName ? `, ${lead.fullName}` : ""}: ${formatSchedule(opportunity.scheduledAt)} em ${opportunity.neighborhood}.`,
      idempotencyKey: `opportunity:${opportunity.id}:${response.id}:confirmed`,
      correlationId: opportunity.id,
    });

    const pendingResponses = await tx.opportunityResponse.findMany({
      where: { opportunityId: opportunity.id, response: null },
      include: { lead: { select: { phoneE164: true, conversation: { select: { provider: true } } } } },
    });
    for (const pending of pendingResponses) {
      await tx.opportunityResponse.update({
        where: { id: pending.id },
        data: { response: "DECLINED", respondedAt: now },
      });
      await enqueueText(tx, {
        provider: pending.lead.conversation?.provider ?? inbound.provider,
        recipient: pending.lead.phoneE164,
        text: "Obrigado pelo interesse! Esta oportunidade acabou de ser preenchida.",
        idempotencyKey: `opportunity:${opportunity.id}:${pending.id}:filled`,
        correlationId: opportunity.id,
      });
    }

    await recordAuditLog(tx, {
      actor: "system:marketplace",
      action: "OPPORTUNITY_ACCEPTED",
      entityType: "OpportunityResponse",
      entityId: response.id,
      metadata: { opportunityId: opportunity.id, bookingId: booking.id, leadId: lead.id },
    });

    return { outcome: "ACCEPTED" as const };
  });
}
