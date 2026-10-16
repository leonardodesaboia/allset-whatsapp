import type { Prisma, PrismaClient } from "@prisma/client";
import { transitionBookingStatus } from "../../domain/booking/booking-state-machine";
import type { BookingStatus } from "../../domain/booking/booking-status";
import {
  formatCustomerContactMessage,
  formatProfessionalContactMessage,
} from "../../domain/marketplace/contact-exchange-message";
import {
  hasScheduleConflict,
  isLeadStatusEligible,
} from "../../domain/marketplace/opportunity-matching-policy";
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
  | "AMBIGUOUS_RESPONSE"
  | "NOT_ELIGIBLE";

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

    const now = new Date();
    const { opportunity, lead } = response;

    const parsed = parseOpportunityReply(input.text)?.response;
    if (!parsed) {
      await enqueueText(tx, {
        provider: inbound.provider,
        recipient: lead.phoneE164,
        text: "Não entendi sua resposta. Responda *SIM* para aceitar ou *NÃO* para recusar a oportunidade.",
        idempotencyKey: `opportunity:${response.id}:invalid:${inbound.id}`,
        correlationId: opportunity.id,
      });
      return { outcome: "INVALID_RESPONSE" as const };
    }

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

    // Serialize this professional's acceptances so two offers answered at the
    // same moment cannot both pass the schedule check below.
    await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${lead.id} FOR UPDATE`;
    const current = await tx.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
      select: { status: true },
    });
    const acceptedSlots = await tx.opportunityResponse.findMany({
      where: {
        leadId: lead.id,
        response: "ACCEPTED",
        opportunity: {
          status: "FILLED",
          id: { not: opportunity.id },
          booking: { assignedProfessionalLeadId: lead.id, status: { not: "CANCELLED" } },
        },
      },
      select: { opportunity: { select: { scheduledAt: true } } },
    });
    if (
      !isLeadStatusEligible(current.status) ||
      hasScheduleConflict(
        acceptedSlots.map((item) => item.opportunity.scheduledAt),
        opportunity.scheduledAt,
      )
    ) {
      // The offer may still go to others; only this professional is excluded.
      await tx.opportunityResponse.updateMany({
        where: { id: response.id, response: null },
        data: { response: "DECLINED", respondedAt: now },
      });
      await enqueueText(tx, {
        provider: lead.conversation?.provider ?? inbound.provider,
        recipient: lead.phoneE164,
        text: "Essa oportunidade não está mais disponível para você. Avisaremos quando surgir uma nova.",
        idempotencyKey: `opportunity:${opportunity.id}:${response.id}:not-eligible`,
        correlationId: opportunity.id,
      });
      await recordAuditLog(tx, {
        actor: "system:marketplace",
        action: "OPPORTUNITY_ACCEPT_REJECTED",
        entityType: "OpportunityResponse",
        entityId: response.id,
        metadata: {
          opportunityId: opportunity.id,
          leadId: lead.id,
          reason: isLeadStatusEligible(current.status) ? "SCHEDULE_CONFLICT" : "LEAD_NOT_ACTIVE",
        },
      });
      return { outcome: "NOT_ELIGIBLE" as const };
    }

    // OPEN -> FILLED is the atomic first-acceptance-wins lock.
    const claimedOpportunity = await tx.serviceOpportunity.updateMany({
      where: { id: opportunity.id, status: "OPEN", expiresAt: { gt: now } },
      data: { status: "FILLED" },
    });
    if (!claimedOpportunity.count) {
      const currentOpp = await tx.serviceOpportunity.findUnique({ where: { id: opportunity.id }, select: { status: true } });
      const tooLateText = currentOpp?.status === "FILLED"
        ? "Esta oportunidade já foi aceita por outra profissional. Avisaremos quando surgir uma nova."
        : "Infelizmente o prazo para aceitar esta oportunidade encerrou. Fique de olho nas próximas!";
      await enqueueText(tx, {
        provider: lead.conversation?.provider ?? inbound.provider,
        recipient: lead.phoneE164,
        text: tooLateText,
        idempotencyKey: `opportunity:${opportunity.id}:${response.id}:too-late`,
        correlationId: opportunity.id,
      });
      return { outcome: "ALREADY_FILLED" as const };
    }

    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: opportunity.bookingId },
      include: {
        customer: { select: { phoneE164: true, fullName: true } },
        customerConversation: { select: { provider: true } },
        propertyPricingTier: { select: { label: true } },
      },
    });
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

    // A AllSet só conecta as partes: cada lado recebe o contato do outro e
    // combina dia, endereço e valor diretamente.
    const customerPhone = booking.customer.phoneE164;
    const customerName =
      booking.customer.fullName && booking.customer.fullName !== customerPhone
        ? booking.customer.fullName
        : null;
    if (customerPhone) {
      await enqueueText(tx, {
        provider: inbound.provider,
        recipient: lead.phoneE164,
        text: formatProfessionalContactMessage({
          customerName,
          customerPhoneE164: customerPhone,
          scheduledAt: opportunity.scheduledAt,
          address: booking.addressLine1,
          addressLine2: booking.addressLine2,
          addressReference: booking.addressReference,
          propertyLabel: booking.propertyPricingTier?.label ?? null,
          estimatedValueCents: opportunity.paymentCents,
        }),
        idempotencyKey: `opportunity:${opportunity.id}:${response.id}:confirmed`,
        correlationId: opportunity.id,
      });
    }

    if (customerPhone && lead.phoneE164) {
      await enqueueText(tx, {
        provider: booking.customerConversation?.provider ?? inbound.provider,
        recipient: customerPhone,
        text: formatCustomerContactMessage({
          professionalName: lead.fullName,
          professionalPhoneE164: lead.phoneE164,
          scheduledAt: opportunity.scheduledAt,
        }),
        idempotencyKey: `opportunity:${opportunity.id}:customer-assigned`,
        correlationId: opportunity.id,
      });
    }

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
