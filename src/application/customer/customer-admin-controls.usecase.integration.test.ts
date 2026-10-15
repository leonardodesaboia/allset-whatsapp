import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  BookingStatus,
  CustomerBookingConversationState,
  PrismaClient,
} from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import {
  controlCustomerConversation,
  processCustomerBookingAnswer,
  resumeCustomerBookingConversation,
} from "./customer-booking-conversation.usecase";
import { sendManualCustomerMessage } from "./send-manual-customer-message.usecase";

describe("customer administrative controls", () => {
  let prisma: PrismaClient;
  let stop: (() => Promise<void>) | undefined;
  let serviceId: string;
  let tierId: string;
  let seq = 0;
  const actor = "admin@test.local";
  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
    serviceId = (
      await prisma.serviceDefinition.create({
        data: { code: "ADMIN-CUSTOMER", name: "Limpeza" },
      })
    ).id;
    tierId = (
      await prisma.propertyPricingTier.create({
        data: {
          label: "Apartamento",
          characteristics: {},
          priceCents: 15000,
          durationMinutes: 180,
        },
      })
    ).id;
  }, 60_000);
  afterAll(async () => {
    await stop?.();
  });
  async function make(
    state: CustomerBookingConversationState = "NAME",
    bookingStatus?: BookingStatus
  ) {
    const customer = await prisma.user.create({
      data: {
        role: "CUSTOMER",
        fullName: "Cliente",
        phoneE164: `+5585988${String(++seq).padStart(6, "0")}`,
      },
    });
    const booking = bookingStatus
      ? await prisma.booking.create({
          data: {
            customerId: customer.id,
            serviceId,
            status: bookingStatus,
            propertyPricingTierId: tierId,
            totalCents: 15000,
            scheduledAt: new Date(Date.now() + 86400000),
            addressLine1: "Rua teste 100",
            coverageValidatedAt: new Date(),
          },
        })
      : null;
    return prisma.customerBookingConversation.create({
      data: {
        customerId: customer.id,
        bookingId: booking?.id ?? null,
        provider: "whatsmiau",
        state,
        lastQuestionKey: state,
      },
    });
  }
  async function control(
    id: string,
    action: "pause" | "step" | "restart" | "close",
    expectedVersion = 0,
    step?: string
  ) {
    return controlCustomerConversation(prisma, {
      conversationId: id,
      expectedVersion,
      actor,
      action,
      ...(step ? { step } : {}),
    });
  }
  it("pauses and resumes a conversation without booking, resending the same question", async () => {
    const c = await make();
    expect((await control(c.id, "pause")).ok).toBe(true);
    const paused = await prisma.customerBookingConversation.findUniqueOrThrow({
      where: { id: c.id },
    });
    expect(paused).toMatchObject({
      state: "PAUSED",
      lastQuestionKey: "NAME",
      version: 1,
    });
    expect(paused.automationPausedAt).not.toBeNull();
    expect(
      (
        await resumeCustomerBookingConversation(prisma, {
          conversationId: c.id,
          expectedVersion: 1,
          actor,
        })
      ).ok
    ).toBe(true);
    expect(
      await prisma.customerBookingConversation.findUniqueOrThrow({
        where: { id: c.id },
      })
    ).toMatchObject({ state: "NAME", version: 2, automationPausedAt: null });
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { correlationId: c.id },
    });
    expect(message.status).toBe("PENDING");
    expect(message.payload).toMatchObject({ text: "Qual é o seu nome?" });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: c.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((entry) => entry.actor)).toEqual([actor, actor]);
  });
  it.each([false, true])(
    "resumes MANUAL_REVIEW (booking: %s) without validating coverage",
    async (hasBooking) => {
      const c = await make(
        "MANUAL_REVIEW",
        hasBooking ? "REVIEW_REQUIRED" : undefined
      );
      expect(
        (
          await resumeCustomerBookingConversation(prisma, {
            conversationId: c.id,
            expectedVersion: 0,
            actor,
          })
        ).ok
      ).toBe(true);
      expect(
        (
          await prisma.customerBookingConversation.findUniqueOrThrow({
            where: { id: c.id },
          })
        ).state
      ).toBe(hasBooking ? "ADDRESS" : "PROPERTY_CHARACTERISTICS");
      if (c.bookingId)
        expect(
          (
            await prisma.booking.findUniqueOrThrow({
              where: { id: c.bookingId },
            })
          ).status
        ).toBe("REVIEW_REQUIRED");
      expect(
        await prisma.outboxMessage.count({ where: { correlationId: c.id } })
      ).toBe(1);
    }
  );
  it("keeps the booking-based resume entry point working", async () => {
    const c = await make("PAUSED", "COLLECTING_DATA");
    await prisma.customerBookingConversation.update({
      where: { id: c.id },
      data: { lastQuestionKey: "SCHEDULE_DATE" },
    });
    expect(
      (
        await resumeCustomerBookingConversation(prisma, {
          bookingId: c.bookingId!,
          actor,
        })
      ).ok
    ).toBe(true);
  });
  it("accepts a new address after resuming coverage review", async () => {
    const c = await make("MANUAL_REVIEW", "REVIEW_REQUIRED");
    await resumeCustomerBookingConversation(prisma, {
      conversationId: c.id,
      expectedVersion: 0,
      actor,
    });
    const customer = await prisma.user.findUniqueOrThrow({
      where: { id: c.customerId },
    });
    const inbound = await prisma.inboundMessage.create({
      data: {
        provider: c.provider,
        externalId: c.id,
        sender: customer.phoneE164,
        recipient: "+5585999990000",
        type: "TEXT",
        payload: { text: "Rua nova, 123, Fortaleza" },
      },
    });
    expect(
      await processCustomerBookingAnswer(prisma, {
        inboundMessageId: inbound.id,
        text: "Rua nova, 123, Fortaleza",
      })
    ).toMatchObject({ advanced: true, state: "MANUAL_REVIEW" });
    expect(
      await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId! } })
    ).toMatchObject({
      status: "REVIEW_REQUIRED",
      addressLine1: "Rua nova, 123, Fortaleza",
      coverageValidatedAt: null,
    });
  });
  it("supersedes old queued prompts but preserves manually authored messages", async () => {
    const c = await make();
    await control(c.id, "step", 0, "NAME");
    await sendManualCustomerMessage(prisma, {
      conversationId: c.id,
      expectedVersion: 1,
      text: "Vou ajudar",
      actor,
    });
    await control(c.id, "step", 2, "INTRODUCTION");
    const messages = await prisma.outboxMessage.findMany({
      where: { correlationId: c.id },
    });
    expect(
      messages.find((m) => m.idempotencyKey.includes(":NAME:"))?.status
    ).toBe("DEAD_LETTER");
    expect(
      messages.find((m) => m.idempotencyKey.includes(":manual:"))?.status
    ).toBe("PENDING");
    expect(
      messages.find((m) => m.idempotencyKey.includes(":INTRODUCTION:"))?.status
    ).toBe("PENDING");
  });
  it("rolls back state, booking history and audit when enqueue fails", async () => {
    const c = await make("PAUSED", "COLLECTING_DATA");
    const failing = prisma.$extends({
      query: {
        outboxMessage: {
          async upsert() {
            throw new Error("outbox unavailable");
          },
        },
      },
    });
    await expect(
      controlCustomerConversation(failing as unknown as PrismaClient, {
        conversationId: c.id,
        expectedVersion: 0,
        actor,
        action: "step",
        step: "QUOTE_ACCEPTANCE",
      })
    ).rejects.toThrow("outbox unavailable");
    expect(
      await prisma.customerBookingConversation.findUniqueOrThrow({
        where: { id: c.id },
      })
    ).toMatchObject({ state: "PAUSED", version: 0 });
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId! } }))
        .status
    ).toBe("COLLECTING_DATA");
    expect(
      await prisma.bookingStatusHistory.count({
        where: { bookingId: c.bookingId! },
      })
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { entityId: { in: [c.id, c.bookingId!] } },
      })
    ).toBe(0);
  });
  it("returns a Result error and rolls back when the booking version claim loses", async () => {
    const c = await make("PAUSED", "COLLECTING_DATA");
    const concurrent = prisma.$extends({ query: { booking: { async updateMany() { return { count: 0 }; } } } });
    const result = await controlCustomerConversation(concurrent as unknown as PrismaClient, { conversationId: c.id, expectedVersion: 0, actor, action: "step", step: "QUOTE_ACCEPTANCE" });
    expect(result.ok).toBe(false);
    expect(await prisma.customerBookingConversation.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ state: "PAUSED", version: 0 });
    expect(await prisma.auditLog.count({ where: { entityId: c.id } })).toBe(0);
    expect(await prisma.outboxMessage.count({ where: { correlationId: c.id } })).toBe(0);
  });
  it("requires a selected date for the time step and resends its choices", async () => {
    const c = await make("PAUSED", "COLLECTING_DATA");
    expect((await control(c.id, "step", 0, "SCHEDULE_TIME")).ok).toBe(false);
    await prisma.customerBookingConversation.update({
      where: { id: c.id },
      data: { pendingScheduleDate: "2030-01-01" },
    });
    expect((await control(c.id, "step", 0, "SCHEDULE_TIME")).ok).toBe(true);
    expect(
      (
        await prisma.outboxMessage.findFirstOrThrow({
          where: { correlationId: c.id },
        })
      ).payload
    ).toMatchObject({ text: expect.stringContaining("horário") });
  });
  it("allows only one concurrent operation for a displayed version; retries do not duplicate messages", async () => {
    const c = await make();
    const results = await Promise.all([
      control(c.id, "step", 0, "INTRODUCTION"),
      control(c.id, "step", 0, "NAME"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await control(c.id, "step", 0, "NAME")).ok).toBe(false);
    expect(
      await prisma.outboxMessage.count({ where: { correlationId: c.id } })
    ).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: c.id } })).toBe(1);
  });
  it.each([
    "SCHEDULE_DATE",
    "QUOTE_ACCEPTANCE",
    "ADDRESS",
    "FINAL_CONFIRMATION",
    "EDIT_SELECTION",
    "AWAITING_PAYMENT",
  ])("resends dynamic and static questions for %s", async (step) => {
    const status =
      step === "AWAITING_PAYMENT"
        ? "AWAITING_PAYMENT"
        : step === "ADDRESS"
          ? "QUOTE_ACCEPTED"
          : "COLLECTING_DATA";
    const c = await make("PAUSED", status);
    expect((await control(c.id, "step", 0, step)).ok).toBe(true);
    const message = await prisma.outboxMessage.findFirstOrThrow({
      where: { correlationId: c.id },
    });
    expect((message.payload as { text: string }).text.length).toBeGreaterThan(
      15
    );
    expect(message.status).toBe("PENDING");
  });
  it("rejects missing prerequisites and irreversible booking transitions without side effects", async () => {
    const c = await make("PAUSED", "PAID");
    for (const action of ["restart", "close", "step"] as const)
      expect(
        (await control(c.id, action, 0, "PROPERTY_CHARACTERISTICS")).ok
      ).toBe(false);
    const noBooking = await make();
    expect(
      (await control(noBooking.id, "step", 0, "FINAL_CONFIRMATION")).ok
    ).toBe(false);
    expect(
      (
        await prisma.customerBookingConversation.findUniqueOrThrow({
          where: { id: c.id },
        })
      ).version
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: c.id } })).toBe(0);
  });
  it("restarts without deleting history and preserves the cancelled booking in audit metadata", async () => {
    const c = await make("PAUSED", "COLLECTING_DATA");
    await sendManualCustomerMessage(prisma, {
      conversationId: c.id,
      text: "Histórico preservado",
      actor,
      expectedVersion: 0,
    });
    expect((await control(c.id, "restart", 1)).ok).toBe(true);
    expect(
      await prisma.customerBookingConversation.findUniqueOrThrow({
        where: { id: c.id },
      })
    ).toMatchObject({
      state: "INTRODUCTION",
      bookingId: null,
      version: 2,
      pendingScheduleDate: null,
    });
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId! } }))
        .status
    ).toBe("CANCELLED");
    expect(
      await prisma.outboxMessage.count({ where: { correlationId: c.id } })
    ).toBe(2);
    expect(
      (
        await prisma.auditLog.findFirstOrThrow({
          where: { entityId: c.id, action: "CUSTOMER_CONVERSATION_RESTART" },
        })
      ).metadata
    ).toMatchObject({
      bookingId: c.bookingId,
      fromState: "PAUSED",
      toState: "INTRODUCTION",
    });
  });
  it("closes and cancels a booking, prevents manual messages until restart", async () => {
    const c = await make("SCHEDULE_DATE", "COLLECTING_DATA");
    expect((await control(c.id, "close")).ok).toBe(true);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId! } }))
        .status
    ).toBe("CANCELLED");
    expect(
      (
        await sendManualCustomerMessage(prisma, {
          conversationId: c.id,
          text: "Não enviar",
          actor,
          expectedVersion: 1,
        })
      ).ok
    ).toBe(false);
    expect((await control(c.id, "restart", 1)).ok).toBe(true);
  });
  it("manual messages use the displayed version, preserve the question and reject duplicate submissions", async () => {
    const c = await make("NAME");
    const input = {
      conversationId: c.id,
      text: "Vou ajudar",
      actor,
      expectedVersion: 0,
    };
    expect((await sendManualCustomerMessage(prisma, input)).ok).toBe(true);
    expect((await sendManualCustomerMessage(prisma, input)).ok).toBe(false);
    expect(
      (
        await prisma.customerBookingConversation.findUniqueOrThrow({
          where: { id: c.id },
        })
      ).lastQuestionKey
    ).toBe("NAME");
    expect(
      await prisma.outboxMessage.count({ where: { correlationId: c.id } })
    ).toBe(1);
  });
});
