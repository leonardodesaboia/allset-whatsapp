import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { transitionBookingStatusUseCase } from "./transition-booking-status.usecase";
import type { PrismaClient } from "@prisma/client";

describe("transitionBookingStatusUseCase", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedBooking() {
    const user = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente Teste", phoneE164: `+5585${Date.now()}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `limpeza-${Date.now()}`, name: "Limpeza comum" },
    });
    return prisma.booking.create({
      data: { customerId: user.id, serviceId: service.id, status: "DRAFT" },
    });
  }

  it("transiciona o status, grava histórico e audit log", async () => {
    const booking = await seedBooking();

    const result = await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COLLECTING_DATA",
      actor: "system:test",
    });

    expect(result.ok).toBe(true);
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe("COLLECTING_DATA");

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: "DRAFT", toStatus: "COLLECTING_DATA" });

    const audit = await prisma.auditLog.findMany({ where: { entityId: booking.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "BOOKING_STATUS_TRANSITION" });
  });

  it("rejeita transição inválida sem escrever nada", async () => {
    const booking = await seedBooking();

    const result = await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COMPLETED",
      actor: "system:test",
    });

    expect(result.ok).toBe(false);
    const unchanged = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(unchanged.status).toBe("DRAFT");
    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(0);
  });

  it("sob concorrência, apenas uma de duas transições simultâneas para o mesmo destino vence", async () => {
    const booking = await seedBooking();
    await transitionBookingStatusUseCase(prisma, {
      bookingId: booking.id,
      targetStatus: "COLLECTING_DATA",
      actor: "system:test",
    });

    // Pré-aquece uma segunda conexão do pool: sem isto, a primeira conexão
    // concorrente que o processo já usa fica "quente" e a segunda precisa
    // abrir uma conexão TCP nova, o que introduz latência suficiente para
    // que as duas transições abaixo deixem de se sobrepor de fato (a segunda
    // só começa depois que a primeira já commitou, mascarando a race que
    // este teste existe para verificar).
    await Promise.all([prisma.$queryRaw`SELECT 1`, prisma.$queryRaw`SELECT 1`]);

    const [first, second] = await Promise.all([
      transitionBookingStatusUseCase(prisma, {
        bookingId: booking.id,
        targetStatus: "REVIEW_REQUIRED",
        actor: "system:A",
      }),
      transitionBookingStatusUseCase(prisma, {
        bookingId: booking.id,
        targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
        actor: "system:B",
      }),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);

    const history = await prisma.bookingStatusHistory.findMany({ where: { bookingId: booking.id } });
    expect(history).toHaveLength(2); // DRAFT->COLLECTING_DATA + a única transição concorrente que venceu
  });
});
