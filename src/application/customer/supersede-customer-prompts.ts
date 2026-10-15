import type { Prisma } from "@prisma/client";

/** Prevent queued questions from the previous step being delivered after an override.
 * Messages already claimed by the dispatcher may still finish sending.
 * Manual messages remain queued, since they were explicitly written by an admin.
 */
export async function supersedeCustomerPrompts(
  tx: Prisma.TransactionClient,
  conversationId: string
) {
  return tx.outboxMessage.updateMany({
    where: {
      correlationId: conversationId,
      status: { in: ["PENDING", "FAILED"] },
      idempotencyKey: {
        startsWith: `customer-booking:${conversationId}:`,
        not: { contains: ":manual:" },
      },
    },
    data: {
      status: "DEAD_LETTER",
      lastError: "Pergunta substituída por controle administrativo.",
      leaseExpiresAt: null,
    },
  });
}
