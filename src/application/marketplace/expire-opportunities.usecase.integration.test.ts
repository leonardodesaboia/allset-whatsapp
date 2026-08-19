import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { expireOpportunities } from "./expire-opportunities.usecase";
import { notifyOpportunity } from "./notify-opportunity.usecase";

describe("expireOpportunities", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedOpportunity(expiresAt: Date) {
    const ts = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const neighborhood = `Aldeota ${ts}`;
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente", phoneE164: `+558540${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `service-${ts}`, name: "Limpeza" },
    });
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        status: "MATCHING",
        neighborhood,
        scheduledAt: new Date(),
        durationMinutes: 180,
        professionalPaymentCents: 10_000,
      },
    });
    const lead = await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: "ATIVA",
        phoneE164: `+558541${ts}`,
        fullName: "Profissional",
        neighborhood,
        canServeInitialArea: "TALVEZ",
      },
    });
    const opportunity = await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id,
        neighborhood,
        scheduledAt: new Date(),
        durationMinutes: 180,
        paymentCents: 10_000,
        expiresAt,
      },
    });
    await prisma.opportunityResponse.create({ data: { opportunityId: opportunity.id, leadId: lead.id } });
    return { booking, opportunity };
  }

  it("expira a oportunidade, as respostas e move o booking para revisão", async () => {
    const { booking, opportunity } = await seedOpportunity(new Date(Date.now() - 1_000));

    const result = await expireOpportunities(prisma);

    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("EXPIRED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("REVIEW_REQUIRED");
    const responses = await prisma.opportunityResponse.findMany({ where: { opportunityId: opportunity.id } });
    expect(responses.every((response) => response.response === "EXPIRED")).toBe(true);
  });

  it("preserva oportunidades que ainda não venceram", async () => {
    const { opportunity } = await seedOpportunity(new Date(Date.now() + 60 * 60 * 1_000));

    await expireOpportunities(prisma);

    expect((await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("OPEN");
  });

  it("não tira o booking de matching se outra oportunidade ainda estiver aberta", async () => {
    const { booking, opportunity } = await seedOpportunity(new Date(Date.now() - 1_000));
    await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id,
        neighborhood: booking.neighborhood!,
        scheduledAt: new Date(),
        durationMinutes: 180,
        paymentCents: 10_000,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });

    await expireOpportunities(prisma);

    expect((await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("EXPIRED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("MATCHING");
  });

  it("permite reenviar matching após expirar, preservando o histórico da oportunidade anterior", async () => {
    const { booking, opportunity } = await seedOpportunity(new Date(Date.now() - 1_000));

    await expireOpportunities(prisma);
    const result = await notifyOpportunity(prisma, { bookingId: booking.id });

    expect(result.notified).toBe(1);
    const opportunities = await prisma.serviceOpportunity.findMany({
      where: { bookingId: booking.id },
      orderBy: { createdAt: "asc" },
    });
    expect(opportunities).toHaveLength(2);
    expect(opportunities[0]?.id).toBe(opportunity.id);
    expect(opportunities[0]?.status).toBe("EXPIRED");
    expect(opportunities[1]?.status).toBe("OPEN");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("MATCHING");
  });
});
