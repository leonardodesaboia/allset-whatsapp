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

  async function seedBooking(opts?: {
    neighborhood?: string;
    scheduledAt?: Date;
  }) {
    const ts = Date.now();
    const customer = await prisma.user.create({
      data: {
        role: "CUSTOMER",
        fullName: "Cliente",
        phoneE164: `+5585100${ts}`,
      },
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
        proposalsAcceptedAt: new Date(),
      },
    });
  }

  it("cria ServiceOpportunity, OpportunityResponses e OutboxMessages apenas para leads elegíveis", async () => {
    const booking = await seedBooking(); // segunda-feira, Aldeota
    const lead1 = await seedLead({
      status: "ATIVA",
      neighborhood: "Aldeota",
      canServe: "SIM",
      availability: ["segunda, quarta, sexta"],
      suffix: "A",
    });
    const lead2 = await seedLead({
      status: "PREFERENCIAL",
      neighborhood: "Aldeota",
      canServe: "TALVEZ",
      availability: ["segunda a sexta"],
      suffix: "B",
    });
    // Inelegível: BASE_FUTURA
    await seedLead({
      status: "BASE_FUTURA",
      neighborhood: "Aldeota",
      canServe: "SIM",
      availability: ["segunda a sexta"],
      suffix: "C",
    });

    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(2);

    const opportunity = await prisma.serviceOpportunity.findFirstOrThrow({
      where: { bookingId: booking.id },
      include: { responses: true },
    });
    expect(opportunity.status).toBe("OPEN");
    expect(opportunity.responses).toHaveLength(2);
    expect(opportunity.responses.map((r) => r.leadId).sort()).toEqual(
      [lead1.id, lead2.id].sort()
    );
    expect(
      opportunity.responses.every((response) =>
        /^[A-Z0-9]{10}$/.test(response.responseToken ?? "")
      )
    ).toBe(true);

    const outbox = await prisma.outboxMessage.findMany({
      where: { correlationId: opportunity.id },
    });
    expect(outbox).toHaveLength(2);

    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(updatedBooking.status).toBe("MATCHING");
  });

  it("não cria oportunidade nem coloca o booking em matching quando não há profissional elegível", async () => {
    // Toda ativa com aceite recebe: isola das profissionais de outros testes.
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    // domingo — nenhum profissional com domingo na disponibilidade
    const booking = await seedBooking({
      scheduledAt: new Date("2026-08-09T13:00:00.000Z"),
    });
    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    expect(result.notified).toBe(0);
    const opportunities = await prisma.serviceOpportunity.findMany({
      where: { bookingId: booking.id },
    });
    expect(opportunities).toHaveLength(0);
    const updatedBooking = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
    });
    expect(updatedBooking.status).toBe("DRAFT");
  });

  it("avisa o cliente que ainda está buscando uma profissional quando não há candidata elegível", async () => {
    // Toda ativa com aceite recebe: isola das profissionais de outros testes.
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const booking = await seedBooking({
      scheduledAt: new Date("2026-08-09T13:00:00.000Z"),
    });
    const customer = await prisma.user.findUniqueOrThrow({
      where: { id: booking.customerId },
    });

    await notifyOpportunity(prisma, { bookingId: booking.id });

    const message = await prisma.outboxMessage.findFirst({
      where: { recipient: customer.phoneE164 },
    });
    expect(message).not.toBeNull();
  });

  it("envia a todas as ativas que aceitaram propostas, sem filtro de bairro ou dia", async () => {
    // Toda ativa com aceite recebe: isola das profissionais de outros testes.
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const booking = await seedBooking({ neighborhood: "Benfica", scheduledAt: new Date("2026-08-09T13:00:00.000Z") });
    const approved = await seedLead({ status: "ATIVA", neighborhood: "Outro bairro", canServe: "NAO", availability: ["domingo"], suffix: "outside" });
    const preferred = await seedLead({ status: "PREFERENCIAL", neighborhood: "Outro bairro", canServe: "TALVEZ", availability: ["domingo"], suffix: "maybe" });
    await prisma.recruitmentLead.update({ where: { id: preferred.id }, data: { canServeInitialArea: null } });
    await seedLead({ status: "SUSPENSA", neighborhood: "Benfica", canServe: "SIM", availability: ["domingo"], suffix: "suspended" });
    // Disponibilidade antiga não filtra mais: ela decide ao receber a proposta.
    const otherDay = await seedLead({ status: "ATIVA", neighborhood: "Benfica", canServe: "SIM", availability: ["sábado"], suffix: "otherday" });
    const withoutConsent = await seedLead({ status: "ATIVA", neighborhood: "Benfica", canServe: "SIM", availability: ["domingo"], suffix: "noconsent" });
    await prisma.recruitmentLead.update({ where: { id: withoutConsent.id }, data: { proposalsAcceptedAt: null } });

    const result = await notifyOpportunity(prisma, { bookingId: booking.id });
    const opportunity = await prisma.serviceOpportunity.findFirstOrThrow({ where: { bookingId: booking.id }, include: { responses: true } });
    expect(result).toEqual({ notified: 3, dispatched: true, opportunityId: opportunity.id });
    expect(opportunity.responses.map((response) => response.leadId).sort()).toEqual([approved.id, preferred.id, otherDay.id].sort());
    const messages = await prisma.outboxMessage.findMany({ where: { correlationId: opportunity.id } });
    expect(messages).toHaveLength(3);
    expect(messages.every((message) => JSON.stringify(message.payload).includes("Benfica"))).toBe(true);
  });
});
