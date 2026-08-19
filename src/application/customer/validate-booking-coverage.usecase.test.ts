import { describe, expect, it, vi } from "vitest";
import { validateCustomerBookingCoverage } from "./validate-booking-coverage.usecase";

describe("validateCustomerBookingCoverage", () => {
  it("cancela o booking quando o endereco fica fora da cobertura", async () => {
    const bookingUpdates: unknown[] = [];
    const tx = {
      booking: {
        findUnique: vi.fn(async () => ({
          id: "3c22f875-61ca-48b1-a31e-e07fd6af9474",
          status: "REVIEW_REQUIRED",
          customerConversation: { id: "conversation-1" },
          customer: { phoneE164: "+5585999999999" },
        })),
        updateMany: vi.fn(async (input) => {
          bookingUpdates.push(input);
          return { count: 1 };
        }),
        update: vi.fn(async (input) => {
          bookingUpdates.push(input);
          return {};
        }),
        findUniqueOrThrow: vi.fn(async () => ({ id: "3c22f875-61ca-48b1-a31e-e07fd6af9474" })),
      },
      bookingStatusHistory: { create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})) },
      customerBookingConversation: {
        update: vi.fn(async () => ({
          id: "conversation-1",
          provider: "mock",
          updatedAt: new Date("2026-08-19T12:00:00.000Z"),
        })),
      },
      outboxMessage: { upsert: vi.fn(async () => ({ id: "outbox-1", provider: "mock" })) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    };

    await expect(validateCustomerBookingCoverage(prisma as never, {
      bookingId: "3c22f875-61ca-48b1-a31e-e07fd6af9474",
      isCovered: false,
      actor: "admin@example.com",
    })).resolves.toEqual({ ok: true, covered: false });

    expect(tx.booking.updateMany).toHaveBeenCalledWith({
      where: { id: "3c22f875-61ca-48b1-a31e-e07fd6af9474", status: "REVIEW_REQUIRED" },
      data: { status: "CANCELLED", version: { increment: 1 } },
    });
    expect(bookingUpdates).toContainEqual({
      where: { id: "3c22f875-61ca-48b1-a31e-e07fd6af9474" },
      data: { outsideCoverageArea: true },
    });
  });
});
