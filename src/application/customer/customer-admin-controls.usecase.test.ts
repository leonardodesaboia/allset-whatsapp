import { describe, expect, it, vi } from "vitest";
import { controlCustomerConversation } from "./customer-booking-conversation.usecase";

const id = "803cb181-4963-4b28-b2ec-e660b0fa041d";
function fixture(overrides = {}) {
  const conversation = {
    id,
    customerId: "customer",
    state: "NAME",
    lastQuestionKey: "NAME",
    version: 3,
    booking: null,
    customer: { phoneE164: "+5585999999999" },
    ...overrides,
  };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    customerBookingConversation: {
      findUnique: vi.fn(async () => conversation),
      findFirst: vi.fn(async () => null),
      findUniqueOrThrow: vi.fn(async () => conversation),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    auditLog: { create: vi.fn() },
    outboxMessage: { upsert: vi.fn() },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) };
  return { tx, prisma };
}
describe("controlCustomerConversation validation", () => {
  const input = {
    conversationId: id,
    expectedVersion: 3,
    actor: "admin@test.local",
    action: "pause" as const,
  };
  it("rejects malformed input without opening a transaction", async () => {
    const { prisma } = fixture();
    expect(
      (
        await controlCustomerConversation(prisma as never, {
          ...input,
          expectedVersion: -1,
        })
      ).ok
    ).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("rejects a stale displayed version before writes", async () => {
    const { tx, prisma } = fixture();
    expect(
      (
        await controlCustomerConversation(prisma as never, {
          ...input,
          expectedVersion: 2,
        })
      ).ok
    ).toBe(false);
    expect(tx.customerBookingConversation.updateMany).not.toHaveBeenCalled();
  });
  it("does not enqueue or audit after losing the optimistic claim", async () => {
    const { tx, prisma } = fixture();
    expect((await controlCustomerConversation(prisma as never, input)).ok).toBe(
      false
    );
    expect(tx.customerBookingConversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, version: 3 } })
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.outboxMessage.upsert).not.toHaveBeenCalled();
  });
  it.each(["QUOTE", "COMPLETED", "INVALID"])(
    "rejects non-interactive step %s",
    async (step) => {
      const { tx, prisma } = fixture();
      expect(
        (
          await controlCustomerConversation(prisma as never, {
            ...input,
            action: "step",
            step,
          })
        ).ok
      ).toBe(false);
      expect(tx.customerBookingConversation.updateMany).not.toHaveBeenCalled();
    }
  );
  it.each([
    "SCHEDULE_DATE",
    "SCHEDULE_TIME",
    "ADDRESS",
    "QUOTE_ACCEPTANCE",
    "FINAL_CONFIRMATION",
    "AWAITING_PAYMENT",
  ])("requires a booking for %s", async (step) => {
    const { tx, prisma } = fixture();
    expect(
      (
        await controlCustomerConversation(prisma as never, {
          ...input,
          action: "step",
          step,
        })
      ).ok
    ).toBe(false);
    expect(tx.customerBookingConversation.updateMany).not.toHaveBeenCalled();
  });
});
