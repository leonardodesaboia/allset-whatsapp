import type { PrismaClient } from "@prisma/client";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

/** Expires open opportunities that have not received an acceptance by their deadline. */
export async function expireOpportunities(
  prisma: PrismaClient,
  input: { now?: Date } = {},
): Promise<{ scanned: number; expired: number }> {
  const now = input.now ?? new Date();
  const candidates = await prisma.serviceOpportunity.findMany({
    where: { status: "OPEN", expiresAt: { lt: now } },
    select: { id: true, bookingId: true },
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

      await tx.opportunityResponse.updateMany({
        where: { opportunityId: candidate.id, response: null },
        data: { response: "EXPIRED", respondedAt: now },
      });

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
