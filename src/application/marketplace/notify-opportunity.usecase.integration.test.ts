import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { notifyOpportunity } from "./notify-opportunity.usecase";

describe("notifyOpportunity", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedBooking(opts?: { neighborhood?: string; scheduledAt?: Date }) {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente", phoneE164: `+5585100${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `svc-${ts}`, name: "Limpeza" },
    });
    return prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        status: "DRAFT",
        neighborhood: opts?.neighborhood ?? "Aldeota",
        scheduledAt: opts?.scheduledAt ?? new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180,
        professionalPaymentCents: 15000,
      },
    });
  }

  async function seedLead(opts: {
    status: string;
    neighborhood: string;
    canServe: "SIM" | "TALVEZ" | "NAO";
    availability: string[];
    suffix: string;
  }) {
    const ts = Date.now();
    return prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: opts.status as never,
        phoneE164: `+5585200${ts}${opts.suffix}`,
        fullName: `Prof ${opts.suffix}`,
        neighborhood: opts.neighborhood,
        canServeInitialArea: opts.canServe,
        availabilityDays: opts.availability,
      },
    });
  }

  it("cria ServiceOpportunity, OpportunityResponses e OutboxMessages apenas para leads elegíveis", async () => {
    const booking = await seedBooking(); // segunda-feira, Aldeota
    const lead1 = await seedLead({ status: "ATIVA", neighborhood: "Aldeota", canServe: "SIM", availability: ["segunda, quarta, sexta"], suffix: "A" });
    const lead2 = await seedLead({ status: "PREFERENCIAL", neighborhood: "Aldeota", canServe: "TALVEZ", availability: ["segunda a sexta"], suffix: "B" });
    // Inelegível: BASE_FUTURA
    await seedLead({ status: "BASE_FUTURA", neighborhood: "Aldeota", canServe: "SIM", availability: ["segunda a sexta"], suffix: "C" });

    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(2);

    const opportunity = await prisma.serviceOpportunity.findFirstOrThrow({
      where: { bookingId: booking.id },
      include: { responses: true },
    });
    expect(opportunity.status).toBe("OPEN");
    expect(opportunity.responses).toHaveLength(2);
    expect(opportunity.responses.map((r) => r.leadId).sort()).toEqual([lead1.id, lead2.id].sort());
    expect(opportunity.responses.every((response) => /^[A-Z0-9]{10}$/.test(response.responseToken ?? ""))).toBe(true);

    const outbox = await prisma.outboxMessage.findMany({ where: { correlationId: opportunity.id } });
    expect(outbox).toHaveLength(2);

    const updatedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updatedBooking.status).toBe("MATCHING");
  });

  it("não cria oportunidade nem coloca o booking em matching quando não há profissional elegível", async () => {
    // domingo — nenhum profissional com domingo na disponibilidade
    const booking = await seedBooking({ scheduledAt: new Date("2026-08-09T13:00:00.000Z") });
    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(0);
    const opportunities = await prisma.serviceOpportunity.findMany({ where: { bookingId: booking.id } });
    expect(opportunities).toHaveLength(0);
    const updatedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updatedBooking.status).toBe("DRAFT");
  });
});
