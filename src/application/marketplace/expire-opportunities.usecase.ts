import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { textPayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

/** Expires open opportunities that have not received an acceptance by their deadline. */
export async function expireOpportunities(
  prisma: PrismaClient,
  input: { now?: Date; opportunityId?: string } = {},
): Promise<{ scanned: number; expired: number }> {
  const now = input.now ?? new Date();
  const candidates = await prisma.serviceOpportunity.findMany({
    where: {
      status: "OPEN",
      expiresAt: { lt: now },
      ...(input.opportunityId ? { id: input.opportunityId } : {}),
    },
    select: { id: true, bookingId: true, scheduledAt: true, neighborhood: true },
  });

  let expired = 0;
  for (const candidate of candidates) {
    const didExpire = await prisma.$transaction(async (tx) => {
      // Claiming with the current status prevents an expiry job from overwriting
      // a concurrent first acceptance.
      const claimed = await tx.serviceOpportunity.updateMany({
        where: { id: candidate.id, status: "OPEN" },
        data: { status: "EXPIRED" },
      });
      if (!claimed.count) return false;

      const pendingResponses = await tx.opportunityResponse.findMany({
        where: { opportunityId: candidate.id, response: null },
        include: { lead: { select: { phoneE164: true, conversation: { select: { provider: true } } } } },
      });

      await tx.opportunityResponse.updateMany({
        where: { opportunityId: candidate.id, response: null },
        data: { response: "EXPIRED", respondedAt: now },
      });

      for (const pending of pendingResponses) {
        if (pending.lead.phoneE164) {
          await enqueueOutboundMessage(tx, {
            provider: pending.lead.conversation?.provider ?? env.MESSAGING_DEFAULT_PROVIDER,
            recipient: pending.lead.phoneE164,
            payload: textPayload("Infelizmente esta oportunidade expirou sem ser preenchida. Avisaremos quando surgir uma nova na sua região!"),
            idempotencyKey: `opportunity:expired:${candidate.id}:${pending.leadId}`,
            correlationId: candidate.id,
            actor: "system:marketplace",
          });
        }
      }

      // A booking can have historical expired opportunities after a recovery.
      // Only escalate it to manual review when this expiry leaves no other open
      // offer that a professional can still accept.
      const openOpportunities = await tx.serviceOpportunity.count({
        where: { bookingId: candidate.bookingId, status: "OPEN" },
      });
      const movedBooking = openOpportunities === 0
        ? await tx.booking.updateMany({
            where: { id: candidate.bookingId, status: "MATCHING" },
            data: { status: "REVIEW_REQUIRED", version: { increment: 1 } },
          })
        : { count: 0 };
      // The booking may already have advanced through a concurrent operation;
      // never fabricate a status-history entry in that case.
      if (movedBooking.count) {
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: candidate.bookingId,
            fromStatus: "MATCHING",
            toStatus: "REVIEW_REQUIRED",
            actor: "system:marketplace",
            reason: "Oportunidade expirou sem aceite",
          },
        });
        const bookingWithCustomer = await tx.booking.findUnique({
          where: { id: candidate.bookingId },
          include: {
            customer: { select: { phoneE164: true } },
            customerConversation: { select: { provider: true } },
          },
        });
        if (bookingWithCustomer?.customer.phoneE164) {
          await enqueueOutboundMessage(tx, {
            provider: bookingWithCustomer.customerConversation?.provider ?? env.MESSAGING_DEFAULT_PROVIDER,
            recipient: bookingWithCustomer.customer.phoneE164,
            payload: textPayload("Ainda estamos buscando uma profissional disponível para seu agendamento. Nossa equipe entrará em contato em breve."),
            idempotencyKey: `booking:no-professional:${candidate.bookingId}`,
            correlationId: candidate.bookingId,
            actor: "system:marketplace",
          });
        }
      }

      await recordAuditLog(tx, {
        actor: "system:marketplace",
        action: "OPPORTUNITY_EXPIRED",
        entityType: "ServiceOpportunity",
        entityId: candidate.id,
        metadata: { bookingId: candidate.bookingId, bookingMovedToReview: Boolean(movedBooking.count) },
      });
      return true;
    });
    if (didExpire) expired += 1;
  }

  return { scanned: candidates.length, expired };
}
