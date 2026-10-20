import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { expireStaleBookings } from "../../application/customer/expire-stale-bookings.usecase";

describe("prisma migrations", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => {
    await stop();
  });

  it("cria e lê um User depois de aplicar as migrations", async () => {
    const user = await prisma.user.create({
      data: {
        role: "ADMIN",
        fullName: "Admin Teste",
        phoneE164: "+5585999990000",
      },
    });
    const found = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(found.role).toBe("ADMIN");
  });

  it("migra cobranças antigas para nova confirmação, preservando pausas e histórico", async () => {
    const customer = await prisma.user.create({
      data: {
        role: "CUSTOMER",
        fullName: "Cliente legado",
        phoneE164: "+5585999990001",
      },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: "LEGACY-MIGRATION", name: "Limpeza" },
    });
    const bookings = [];
    for (const paused of [false, true]) {
      const booking = await prisma.booking.create({
        data: {
          customerId: customer.id,
          serviceId: service.id,
          status: paused ? "PAYMENT_FAILED" : "AWAITING_PAYMENT",
          confirmedAt: new Date(),
          addressLine1: "Rua Privada, 123",
          updatedAt: new Date("2020-01-01"),
          customerConversation: {
            create: {
              customerId: customer.id,
              provider: "mock",
              state: paused ? "PAUSED" : "AWAITING_PAYMENT",
              lastQuestionKey: "AWAITING_PAYMENT",
            },
          },
        },
      });
      bookings.push(booking);
    }
    // Mesmo antes da migração, o cron antigo não pode mais cobrar nem cancelar.
    expect(await expireStaleBookings(prisma)).toMatchObject({
      reminders: 0,
      cancelled: 0,
    });
    expect(
      (
        await prisma.booking.findUniqueOrThrow({
          where: { id: bookings[0]!.id },
        })
      ).status
    ).toBe("AWAITING_PAYMENT");
    await prisma.outboxMessage.createMany({
      data: [
        {
          provider: "mock",
          recipient: customer.phoneE164!,
          type: "TEXT",
          payload: { text: "Realize o PIX" },
          idempotencyKey: "payment-reminder:old",
          status: "PENDING",
        },
        {
          provider: "mock",
          recipient: customer.phoneE164!,
          type: "TEXT",
          payload: { text: "PIX enviado antes" },
          idempotencyKey: "payment-cancelled:history",
          status: "SENT",
        },
        {
          provider: "mock",
          recipient: customer.phoneE164!,
          type: "TEXT",
          payload: { text: "Confirme o PIX" },
          idempotencyKey: "customer-booking:old:AWAITING_PAYMENT:123",
          status: "FAILED",
        },
      ],
    });
    const opportunity = await prisma.serviceOpportunity.create({
      data: {
        bookingId: bookings[0]!.id,
        neighborhood: "Rua Privada, 123",
        scheduledAt: new Date(),
        expiresAt: new Date(),
      },
    });
    const sql = readFileSync(
      new URL(
        "../../../prisma/migrations/20261019180000_harden_simple_professional_flow/migration.sql",
        import.meta.url
      ),
      "utf8"
    );
    for (let run = 0; run < 2; run++) {
      for (const statement of sql
        .split(/;\s*(?:\r?\n|$)/)
        .filter((part) => part.trim()))
        await prisma.$executeRawUnsafe(statement);
    }
    for (const [index, booking] of bookings.entries()) {
      const updated = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        include: { customerConversation: true, history: true },
      });
      expect(updated.status).toBe("AWAITING_CUSTOMER_CONFIRMATION");
      expect(updated.confirmedAt).toBeNull();
      expect(updated.version).toBe(1);
      expect(updated.history).toHaveLength(1);
      expect(updated.customerConversation?.state).toBe(
        index === 0 ? "FINAL_CONFIRMATION" : "PAUSED"
      );
      expect(updated.customerConversation?.lastQuestionKey).toBe(
        "FINAL_CONFIRMATION"
      );
    }
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: { idempotencyKey: "payment-reminder:old" },
        })
      ).status
    ).toBe("CANCELLED");
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: {
            idempotencyKey: "customer-booking:old:AWAITING_PAYMENT:123",
          },
        })
      ).status
    ).toBe("CANCELLED");
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: { idempotencyKey: "payment-cancelled:history" },
        })
      ).status
    ).toBe("SENT");
    expect(
      (
        await prisma.serviceOpportunity.findUniqueOrThrow({
          where: { id: opportunity.id },
        })
      ).neighborhood
    ).toBe("Bairro a confirmar");
  });
});
