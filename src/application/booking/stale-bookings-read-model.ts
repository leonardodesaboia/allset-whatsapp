import type { PrismaClient } from "@prisma/client";

/** Statuses that depend on a human action (payment confirmation, finding a
 * professional, re-reviewing coverage) with no automatic follow-up otherwise. */
const STALE_STATUSES = [
  "AWAITING_PAYMENT",
  "REVIEW_REQUIRED",
  "MATCHING",
] as const;

export async function countStaleBookings(
  prisma: Pick<PrismaClient, "booking">,
  input: { staleAfterHours: number; now?: Date }
): Promise<number> {
  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - input.staleAfterHours * 60 * 60 * 1000
  );
  return prisma.booking.count({
    where: { status: { in: [...STALE_STATUSES] }, updatedAt: { lt: cutoff } },
  });
}
