import type { PrismaClient } from "@prisma/client";

export type OperationsOverview = {
  coverageAwaitingValidation: number;
  conversationsPaused: number;
  conversationsManualReview: number;
  outboxPending: number;
  outboxOverdue: number;
  outboxFailed: number;
  outboxDeadLetter: number;
  documentsPending: number;
  opportunitiesWithoutResponse: number;
  leadsNeedingAttention: number;
  staleBookings: number;
  activePricingTiers: number;
  activeServices: number;
  lastMessageSentAt: Date | null;
  providerBlockedUntil: Date | null;
  providerLastError: string | null;
};

const STALE_STATUSES = ["AWAITING_PAYMENT", "REVIEW_REQUIRED", "MATCHING"] as const;
const OUTBOX_OVERDUE_AFTER_MS = 5 * 60 * 1000;

export async function getOperationsOverview(
  prisma: Pick<
    PrismaClient,
    | "booking"
    | "customerBookingConversation"
    | "outboxMessage"
    | "professionalDocument"
    | "serviceOpportunity"
    | "recruitmentLead"
    | "propertyPricingTier"
    | "serviceDefinition"
    | "messagingProviderState"
  >,
  input: { staleAfterHours: number; now?: Date },
): Promise<OperationsOverview> {
  const now = input.now ?? new Date();
  const staleCutoff = new Date(now.getTime() - input.staleAfterHours * 60 * 60 * 1000);
  const overdueCutoff = new Date(now.getTime() - OUTBOX_OVERDUE_AFTER_MS);

  const [
    coverageAwaitingValidation,
    conversationsPaused,
    conversationsManualReview,
    outboxPending,
    outboxOverdue,
    outboxFailed,
    outboxDeadLetter,
    documentsPending,
    opportunitiesWithoutResponse,
    leadsNeedingAttention,
    staleBookings,
    activePricingTiers,
    activeServices,
    lastSent,
    providerStates,
  ] = await Promise.all([
    prisma.booking.count({
      where: {
        status: "REVIEW_REQUIRED",
        customerConversation: { is: { lastQuestionKey: "MANUAL_REVIEW" } },
      },
    }),
    prisma.customerBookingConversation.count({ where: { state: "PAUSED" } }),
    prisma.customerBookingConversation.count({ where: { state: "MANUAL_REVIEW" } }),
    prisma.outboxMessage.count({ where: { status: "PENDING" } }),
    prisma.outboxMessage.count({ where: { status: "PENDING", availableAt: { lt: overdueCutoff } } }),
    prisma.outboxMessage.count({ where: { status: "FAILED" } }),
    prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } }),
    prisma.professionalDocument.count({ where: { status: "RECEIVED" } }),
    prisma.serviceOpportunity.count({
      where: { status: "OPEN", expiresAt: { gt: now }, responses: { none: {} } },
    }),
    prisma.recruitmentLead.count({
      where: {
        OR: [
          { status: "LIGACAO_SOLICITADA" },
          { status: "PRECISA_DE_AJUDA" },
          { status: "AGUARDANDO_COMPLEMENTACAO" },
          { nextActionAt: { lt: now } },
        ],
      },
    }),
    prisma.booking.count({
      where: { status: { in: [...STALE_STATUSES] }, updatedAt: { lt: staleCutoff } },
    }),
    prisma.propertyPricingTier.count({ where: { isActive: true } }),
    prisma.serviceDefinition.count({ where: { isActive: true } }),
    prisma.outboxMessage.findFirst({
      where: { status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    prisma.messagingProviderState.findMany({
      where: { blockedUntil: { gt: now } },
      select: { blockedUntil: true, lastError: true },
      take: 1,
    }),
  ]);

  return {
    coverageAwaitingValidation,
    conversationsPaused,
    conversationsManualReview,
    outboxPending,
    outboxOverdue,
    outboxFailed,
    outboxDeadLetter,
    documentsPending,
    opportunitiesWithoutResponse,
    leadsNeedingAttention,
    staleBookings,
    activePricingTiers,
    activeServices,
    lastMessageSentAt: lastSent?.sentAt ?? null,
    providerBlockedUntil: providerStates[0]?.blockedUntil ?? null,
    providerLastError: providerStates[0]?.lastError ?? null,
  };
}
