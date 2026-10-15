import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { getOperationsOverview } from "./operations-overview-read-model";

describe("getOperationsOverview", () => {
  let prisma: PrismaClient;
  let stop: (() => Promise<void>) | undefined;
  let serviceId: string;
  let seq = 0;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
    serviceId = (
      await prisma.serviceDefinition.create({
        data: { code: "OVERVIEW", name: "Limpeza" },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await stop?.();
  });

  async function customer() {
    return prisma.user.create({
      data: {
        role: "CUSTOMER",
        fullName: "Cliente",
        phoneE164: `+5585977${String(++seq).padStart(6, "0")}`,
      },
    });
  }

  it("conta pendências por categoria e ignora o que não precisa de ação", async () => {
    const now = new Date();
    const reviewer = await customer();
    const reviewBooking = await prisma.booking.create({
      data: {
        customerId: reviewer.id,
        serviceId,
        status: "REVIEW_REQUIRED",
        addressLine1: "Rua A, 1",
      },
    });
    await prisma.customerBookingConversation.create({
      data: {
        customerId: reviewer.id,
        bookingId: reviewBooking.id,
        provider: "whatsmiau",
        state: "MANUAL_REVIEW",
        lastQuestionKey: "MANUAL_REVIEW",
      },
    });

    const paused = await customer();
    await prisma.customerBookingConversation.create({
      data: { customerId: paused.id, provider: "whatsmiau", state: "PAUSED" },
    });

    // Revisão necessária por outro motivo (sem cobertura manual) não entra em "cobertura".
    const otherReview = await customer();
    await prisma.booking.create({
      data: {
        customerId: otherReview.id,
        serviceId,
        status: "REVIEW_REQUIRED",
      },
    });

    await prisma.outboxMessage.createMany({
      data: [
        {
          provider: "whatsmiau",
          recipient: "+5585900000001",
          type: "TEXT",
          payload: {},
          status: "DEAD_LETTER",
          idempotencyKey: "ov-dead",
        },
        {
          provider: "whatsmiau",
          recipient: "+5585900000002",
          type: "TEXT",
          payload: {},
          status: "FAILED",
          idempotencyKey: "ov-failed",
        },
        {
          provider: "whatsmiau",
          recipient: "+5585900000003",
          type: "TEXT",
          payload: {},
          status: "PENDING",
          idempotencyKey: "ov-old",
          availableAt: new Date(now.getTime() - 60 * 60 * 1000),
        },
        {
          provider: "whatsmiau",
          recipient: "+5585900000004",
          type: "TEXT",
          payload: {},
          status: "SENT",
          sentAt: now,
          idempotencyKey: "ov-sent",
        },
      ],
    });

    await prisma.serviceOpportunity.create({
      data: {
        bookingId: reviewBooking.id,
        neighborhood: "Aldeota",
        scheduledAt: new Date(now.getTime() + 86400000),
        paymentCents: 10000,
        status: "OPEN",
        expiresAt: new Date(now.getTime() + 3600000),
      },
    });

    const overview = await getOperationsOverview(prisma, {
      staleAfterHours: 24,
      now,
    });

    expect(overview.coverageAwaitingValidation).toBe(1);
    expect(overview.conversationsManualReview).toBe(1);
    expect(overview.conversationsPaused).toBe(1);
    expect(overview.outboxDeadLetter).toBe(1);
    expect(overview.outboxFailed).toBe(1);
    expect(overview.outboxPending).toBe(1);
    expect(overview.outboxOverdue).toBe(1);
    expect(overview.opportunitiesWithoutResponse).toBe(1);
    expect(overview.lastMessageSentAt?.getTime()).toBe(now.getTime());
    expect(overview.activeServices).toBe(1);
    expect(overview.activePricingTiers).toBe(0);
  });
});
