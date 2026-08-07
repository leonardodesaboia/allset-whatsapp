import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processOpportunityResponse } from "./process-opportunity-response.usecase";

describe("processOpportunityResponse", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function seedScene() {
    const ts = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const customer = await prisma.user.create({
      data: { role: "CUSTOMER", fullName: "Cliente", phoneE164: `+558530${ts}` },
    });
    const service = await prisma.serviceDefinition.create({
      data: { code: `service-${ts}`, name: "Limpeza" },
    });
    const booking = await prisma.booking.create({
      data: {
        customerId: customer.id,
        serviceId: service.id,
        status: "MATCHING",
        neighborhood: "Aldeota",
        scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180,
        professionalPaymentCents: 15_000,
      },
    });
    const opportunity = await prisma.serviceOpportunity.create({
      data: {
        bookingId: booking.id,
        neighborhood: "Aldeota",
        scheduledAt: new Date("2026-08-10T13:00:00.000Z"),
        durationMinutes: 180,
        paymentCents: 15_000,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      },
    });
    const lead1 = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "ATIVA", phoneE164: `+558531${ts}`, fullName: "Ana" },
    });
    const lead2 = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "ATIVA", phoneE164: `+558532${ts}`, fullName: "Bia" },
    });
    const response1 = await prisma.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead1.id },
    });
    const response2 = await prisma.opportunityResponse.create({
      data: { opportunityId: opportunity.id, leadId: lead2.id },
    });
    const makeInbound = (phone: string, text: string, suffix: string) =>
      prisma.inboundMessage.create({
        data: {
          provider: "mock",
          externalId: `${ts}-${suffix}`,
          sender: phone,
          recipient: "+5585000000000",
          type: "TEXT",
          payload: { version: 1, type: "TEXT", text },
        },
      });
    return { booking, opportunity, lead1, lead2, response1, response2, makeInbound };
  }

  it("aceita apenas a primeira profissional e move o booking", async () => {
    const { booking, opportunity, lead1, response1, response2, makeInbound } = await seedScene();
    const inbound = await makeInbound(lead1.phoneE164!, "sim", "accept");

    await expect(processOpportunityResponse(prisma, {
      responseId: response1.id, text: "SIM", inboundMessageId: inbound.id,
    })).resolves.toEqual({ outcome: "ACCEPTED" });

    expect((await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("FILLED");
    const updatedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updatedBooking.status).toBe("PROFESSIONAL_ASSIGNED");
    expect(updatedBooking.assignedProfessionalLeadId).toBe(lead1.id);
    expect((await prisma.opportunityResponse.findUniqueOrThrow({ where: { id: response1.id } })).response).toBe("ACCEPTED");
    expect((await prisma.opportunityResponse.findUniqueOrThrow({ where: { id: response2.id } })).response).toBe("DECLINED");
    expect(await prisma.outboxMessage.count({ where: { correlationId: opportunity.id } })).toBe(2);
  });

  it("recusa sem alterar o booking", async () => {
    const { booking, response1, lead1, makeInbound } = await seedScene();
    const inbound = await makeInbound(lead1.phoneE164!, "não", "decline");

    await expect(processOpportunityResponse(prisma, {
      responseId: response1.id, text: "não", inboundMessageId: inbound.id,
    })).resolves.toEqual({ outcome: "DECLINED" });

    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("MATCHING");
    expect((await prisma.opportunityResponse.findUniqueOrThrow({ where: { id: response1.id } })).response).toBe("DECLINED");
  });

  it("não processa duas vezes o mesmo inbound nem aceita resposta de outro remetente", async () => {
    const { opportunity, lead1, lead2, response1, makeInbound } = await seedScene();
    const inbound = await makeInbound(lead2.phoneE164!, "sim", "mismatch");
    await expect(processOpportunityResponse(prisma, {
      responseId: response1.id, text: "sim", inboundMessageId: inbound.id,
    })).resolves.toEqual({ outcome: "NOT_FOUND" });
    expect((await prisma.serviceOpportunity.findUniqueOrThrow({ where: { id: opportunity.id } })).status).toBe("OPEN");

    const validInbound = await makeInbound(lead1.phoneE164!, "sim", "duplicate");
    await processOpportunityResponse(prisma, { responseId: response1.id, text: "sim", inboundMessageId: validInbound.id });
    await expect(processOpportunityResponse(prisma, {
      responseId: response1.id, text: "sim", inboundMessageId: validInbound.id,
    })).resolves.toEqual({ outcome: "DUPLICATE_INBOUND" });
  });
});
