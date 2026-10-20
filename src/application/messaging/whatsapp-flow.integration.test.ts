import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processInboundEvent } from "./process-inbound-event.usecase";
import { routeInboundText } from "./route-inbound-text.usecase";
import { processPendingReceivedAudio } from "./process-pending-received-audio.usecase";
import { dispatchNextOutboxMessage } from "./dispatch-outbox.usecase";
import { enqueueOutboundMessage } from "./enqueue-outbound-message.usecase";
import {
  controlCustomerConversation,
  startCustomerBookingConversation,
} from "../customer/customer-booking-conversation.usecase";
import { expireOpportunities } from "../marketplace/expire-opportunities.usecase";
import { requestProposalConsentFromActiveProfessionals } from "../recruitment/request-proposal-consent.usecase";
import { customerScheduleDateChoices } from "../../domain/customer/customer-schedule";
import { validateCustomerBookingCoverage } from "../customer/validate-booking-coverage.usecase";
import { reengageSilentCustomerConversations } from "../customer/reengage-silent-customer-conversations.usecase";
import { textPayload } from "../../domain/messaging/message";
import { MockMessagingAdapter } from "../../infrastructure/messaging/mock-messaging-adapter";
import { StaticMessagingGatewayRegistry } from "../../infrastructure/messaging/messaging-gateway-registry";
import { InMemoryStorageProvider } from "../../infrastructure/storage/in-memory-storage-provider";
import { prepareBookingMatching } from "../booking/prepare-booking-matching.usecase";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { notifyOpportunity } from "../marketplace/notify-opportunity.usecase";
import { transcribeReceivedAudio } from "./transcribe-received-audio.usecase";

describe("WhatsApp conversation flows (isolated PostgreSQL, no real messages)", () => {
  let prisma: PrismaClient;
  let stop = async () => {};
  let seq = 0;
  let tierId: string;
  const phone = () => `+5585911${String(++seq).padStart(6, "0")}`;
  const DETAILS = "Apto 2 quartos, limpeza completa";

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
    await prisma.serviceDefinition.create({
      data: { code: "CLEANING", name: "Limpeza" },
    });
    const tier = await prisma.propertyPricingTier.create({
      data: {
        label: "Apartamento de 2 quartos",
        characteristics: { bedrooms: 2 },
        priceCents: 15000,
        durationMinutes: 180,
      },
    });
    tierId = tier.id;
  }, 60_000);
  afterAll(async () => stop());
  beforeEach(async () => {
    await prisma.outboxMessage.deleteMany();
    await prisma.customerBookingConversation.updateMany({
      data: { lastInboundAt: new Date("2099-01-01T00:00:00Z") },
    });
    await prisma.propertyPricingTier.update({
      where: { id: tierId },
      data: { priceCents: 15000 },
    });
  });

  async function receive(
    sender: string,
    text: string,
    externalId = randomUUID()
  ) {
    const { message } = await processInboundEvent(prisma, {
      provider: "mock",
      externalId,
      sender,
      recipient: "+5585987231727",
      payload: textPayload(text),
    });
    await routeInboundText(prisma, {
      inboundMessageId: message.id,
      phoneE164: sender,
      text,
      provider: "mock",
    });
    return message.id;
  }
  const conversation = (sender: string) =>
    prisma.customerBookingConversation.findFirstOrThrow({
      where: { customer: { phoneE164: sender } },
      orderBy: { createdAt: "desc" },
      include: { booking: true },
    });
  async function customerWithRequestSent() {
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "amanhã às 14h",
      "Rua Teste, 123, Meireles",
      DETAILS,
      "1",
    ])
      await receive(sender, text);
    return sender;
  }
  async function registerProfessional() {
    // Offers to professionals from earlier tests would use the default provider.
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const professional = phone();
    await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: "ATIVA",
        proposalsAcceptedAt: new Date(),
        phoneE164: professional,
        fullName: "Joana Profissional",
        neighborhood: "Meireles",
        canServeInitialArea: "SIM",
        availabilityDays: [
          "segunda",
          "terça",
          "quarta",
          "quinta",
          "sexta",
          "sábado",
          "domingo",
        ],
        conversation: { create: { provider: "mock", state: "COMPLETED" } },
      },
    });
    return { phone: professional };
  }
  async function sentTexts(sender: string) {
    const gateway = new MockMessagingAdapter();
    const registry = new StaticMessagingGatewayRegistry([["mock", gateway]]);
    for (let i = 0; i < 100; i++)
      if (!(await dispatchNextOutboxMessage(prisma, registry))) break;
    return gateway.sent
      .filter(
        (item) => item.recipient === sender && item.payload.type === "TEXT"
      )
      .map((item) => (item.payload.type === "TEXT" ? item.payload.text : ""));
  }

  /** Drains the outbox once and returns everything sent, for several recipients. */
  async function drainOutbox() {
    const gateway = new MockMessagingAdapter();
    const registry = new StaticMessagingGatewayRegistry([["mock", gateway]]);
    for (let i = 0; i < 100; i++)
      if (!(await dispatchNextOutboxMessage(prisma, registry))) break;
    return gateway.sent.flatMap((item) =>
      item.payload.type === "TEXT"
        ? [{ recipient: item.recipient, text: item.payload.text }]
        : []
    );
  }

  it("asks a new customer for their name before anything else", async () => {
    const sender = phone();
    await receive(sender, "Oi");
    await receive(sender, "1");
    expect((await conversation(sender)).state).toBe("NAME");
    await receive(sender, "Maria Souza");
    const afterName = await conversation(sender);
    // Sem tipo de imóvel: depois do nome vem direto o dia e horário.
    expect(afterName.state).toBe("SCHEDULE_DATE");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { phoneE164: sender } }))
        .fullName
    ).toBe("Maria Souza");
  });

  it("never asks for the name again once the customer already has one", async () => {
    const sender = await customerWithRequestSent();
    await prisma.customerBookingConversation.updateMany({
      where: { customer: { phoneE164: sender } },
      data: { state: "COMPLETED" },
    });
    const restarted = await startCustomerBookingConversation(prisma, {
      phoneE164: sender,
      provider: "mock",
    });
    if (!restarted.started) throw new Error("Fixture did not start");
    expect(restarted.conversation.state).not.toBe("NAME");
  });

  it("escalates to a human after repeated invalid answers to the same question", async () => {
    const sender = phone();
    await receive(sender, "Oi");
    await receive(sender, "1");
    expect((await conversation(sender)).state).toBe("NAME");
    await receive(sender, "1");
    expect((await conversation(sender)).state).toBe("NAME");
    await receive(sender, "2");
    const conv = await conversation(sender);
    expect(conv.state).toBe("PAUSED");
    const texts = await sentTexts(sender);
    expect(texts.some((text) => text.includes("Uma pessoa da AllSet"))).toBe(
      true
    );
  });

  it("does not escalate when a later mistake is on a different question", async () => {
    const sender = phone();
    await receive(sender, "Oi");
    await receive(sender, "1");
    await receive(sender, "1");
    await receive(sender, "Maria Souza");
    expect((await conversation(sender)).state).toBe("SCHEDULE_DATE");
    await receive(sender, "99");
    expect((await conversation(sender)).state).toBe("SCHEDULE_DATE");
  });

  it("resets the misunderstanding counter once a conversation is resumed", async () => {
    const sender = phone();
    await receive(sender, "Oi");
    await receive(sender, "1");
    await receive(sender, "1");
    await receive(sender, "PARAR");
    expect((await conversation(sender)).state).toBe("PAUSED");
    await receive(sender, "MENU");
    expect((await conversation(sender)).state).toBe("NAME");
    await receive(sender, "2");
    expect((await conversation(sender)).state).toBe("NAME");
  });

  it("takes a client from the first message to matching without any payment step", async () => {
    await registerProfessional();
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    expect(conv.state).toBe("COMPLETED");
    expect(conv.booking?.status).toBe("MATCHING");
    expect(conv.booking?.neighborhood).toBe("Meireles");
    expect(conv.booking?.addressLine1).toBe("Rua Teste, 123, Meireles");
    expect(conv.booking?.customerNotes).toBe(DETAILS);
    expect(conv.booking?.propertyPricingTierId).toBeNull();
    const texts = await sentTexts(sender);
    const summary = texts.find((text) => text.startsWith("Confira os dados"))!;
    expect(summary).toContain("14:00");
    expect(summary).toContain("Rua Teste, 123, Meireles");
    expect(summary).toContain(DETAILS);
    const dispatched = texts.at(-1)!;
    expect(dispatched).toContain("Rua Teste, 123, Meireles");
    expect(dispatched).toContain(DETAILS);
    for (const text of texts) {
      expect(text).not.toMatch(
        /PIX|pagar|pagamento|validar o endereço|R\$|descreve melhor o seu imóvel/i
      );
    }
    expect(
      await prisma.serviceOpportunity.count({
        where: { bookingId: conv.bookingId!, status: "OPEN" },
      })
    ).toBe(1);
  });

  it("never sends the customer to coverage review or waits for an admin", async () => {
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    expect(conv.state).not.toBe("MANUAL_REVIEW");
    expect(conv.booking?.status).not.toBe("REVIEW_REQUIRED");
    expect(conv.booking?.outsideCoverageArea).toBe(false);
    const texts = await sentTexts(sender);
    expect(texts.join("\n")).not.toMatch(/validar o endere/i);
  });

  it("keeps the request waiting for a professional when none is eligible yet", async () => {
    // Other tests in this file registered professionals; take them out of matching.
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    expect(conv.state).toBe("COMPLETED");
    expect(conv.booking?.status).toBe("AWAITING_CUSTOMER_CONFIRMATION");
    expect(
      await prisma.serviceOpportunity.count({
        where: { bookingId: conv.bookingId! },
      })
    ).toBe(0);
    expect((await sentTexts(sender)).at(-1)).toMatch(
      /buscando uma profissional/i
    );
    // The admin can still prepare and send it once someone becomes eligible.
    await registerProfessional();
    await prepareBookingMatching(prisma, {
      bookingId: conv.bookingId!,
      neighborhood: "Meireles",
      professionalPaymentCents: null,
      actor: "test:admin",
    });
    expect(
      (
        await notifyOpportunity(prisma, {
          bookingId: conv.bookingId!,
          actor: "test:admin",
        })
      ).dispatched
    ).toBe(true);
  });

  it("asks for the bairro only when it cannot be read from the address", async () => {
    await registerProfessional();
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "amanhã às 14h",
      "Rua das Flores 123",
    ])
      await receive(sender, text);
    expect((await conversation(sender)).state).toBe("NEIGHBORHOOD");
    await receive(sender, "Meireles");
    expect((await conversation(sender)).state).toBe("PROPERTY_CHARACTERISTICS");
    await receive(sender, DETAILS);
    expect((await conversation(sender)).state).toBe("FINAL_CONFIRMATION");
    await receive(sender, "1");
    const conv = await conversation(sender);
    expect(conv.state).toBe("COMPLETED");
    expect(conv.booking?.status).toBe("MATCHING");
    expect(conv.booking?.neighborhood).toBe("Meireles");
  });

  it("shows a summary and lets the customer change only the day and time", async () => {
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "amanhã 14h",
      "Rua Teste, 123, Meireles",
      DETAILS,
    ])
      await receive(sender, text);
    let conv = await conversation(sender);
    expect(conv.state).toBe("FINAL_CONFIRMATION");
    expect(conv.booking?.scheduledAt?.toISOString().slice(11, 16)).toBe(
      "17:00"
    );
    await receive(sender, "2");
    expect((await conversation(sender)).state).toBe("EDIT_SELECTION");
    await receive(sender, "1");
    expect((await conversation(sender)).state).toBe("SCHEDULE_DATE");
    await receive(sender, "depois de amanhã 9h");
    conv = await conversation(sender);
    // Endereço e detalhes já informados: volta direto ao resumo.
    expect(conv.state).toBe("FINAL_CONFIRMATION");
    expect(conv.booking?.scheduledAt?.toISOString().slice(11, 16)).toBe(
      "12:00"
    );
    expect(conv.booking?.customerNotes).toBe(DETAILS);
    expect(conv.booking?.status).toBe("COLLECTING_DATA");
  });

  it("asks the day again when the chosen time already passed at confirmation", async () => {
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "amanhã 14h",
      "Rua Teste, 123, Meireles",
      DETAILS,
    ])
      await receive(sender, text);
    const conv = await conversation(sender);
    await prisma.booking.update({
      where: { id: conv.bookingId! },
      data: { scheduledAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await receive(sender, "1");
    const after = await conversation(sender);
    expect(after.state).toBe("SCHEDULE_DATE");
    expect(after.booking?.scheduledAt).toBeNull();
    expect(
      await prisma.serviceOpportunity.count({
        where: { bookingId: conv.bookingId! },
      })
    ).toBe(0);
    expect((await sentTexts(sender)).at(-1)).toMatch(/já passou/);
  });

  it("answers with the request status after it was sent, and NOVO starts another one", async () => {
    await registerProfessional();
    const sender = await customerWithRequestSent();
    const sent = await conversation(sender);
    await receive(sender, "obrigado!");
    expect((await conversation(sender)).id).toBe(sent.id);
    expect((await sentTexts(sender)).at(-1)).toMatch(
      /já está com as profissionais[\s\S]*responda NOVO/
    );
    await receive(sender, "NOVO");
    const next = await conversation(sender);
    expect(next.id).not.toBe(sent.id);
    expect(next.state).toBe("SCHEDULE_DATE");
  });

  it("does not claim the request is with professionals when none received it", async () => {
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const sender = await customerWithRequestSent();
    await receive(sender, "obrigado");
    const last = (await sentTexts(sender)).at(-1)!;
    expect(last).toMatch(/Ainda estamos buscando/);
    expect(last).not.toMatch(/já está com as profissionais/);
  });

  it("CANCELAR after sending cancels the request and stops queued offers", async () => {
    await registerProfessional();
    const sender = await customerWithRequestSent();
    const sent = await conversation(sender);
    await receive(sender, "cancelar");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: sent.bookingId! } });
    expect(booking.status).toBe("CANCELLED");
    const opportunity = await prisma.serviceOpportunity.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(opportunity.status).toBe("CANCELLED");
    expect(
      await prisma.outboxMessage.count({
        where: { correlationId: opportunity.id, idempotencyKey: { endsWith: ":offer" }, status: "PENDING" },
      })
    ).toBe(0);
    expect((await sentTexts(sender)).at(-1)).toMatch(/Pedido cancelado/);
  });

  it("CANCELAR during the conversation closes it without sending anything", async () => {
    const sender = phone();
    for (const text of ["Oi", "1", "Maria Souza", "amanhã às 14h"]) await receive(sender, text);
    await receive(sender, "CANCELAR");
    const conv = await conversation(sender);
    expect(conv.state).toBe("COMPLETED");
    expect(conv.booking?.status).toBe("CANCELLED");
  });

  it("AJUDA after sending pauses for the team, and closing it never cancels the request", async () => {
    await registerProfessional();
    const sender = await customerWithRequestSent();
    await receive(sender, "ajuda");
    const paused = await conversation(sender);
    expect(paused).toMatchObject({ state: "PAUSED", lastQuestionKey: "COMPLETED" });
    expect(paused.booking?.status).toBe("MATCHING");
    const closed = await controlCustomerConversation(prisma, {
      conversationId: paused.id,
      expectedVersion: paused.version,
      actor: "test:admin",
      action: "close",
    });
    expect(closed.ok).toBe(true);
    expect((await conversation(sender)).booking?.status).toBe("MATCHING");
  });

  it("a professional who withdraws (DESISTO) sends the request back to the others", async () => {
    const first = await registerProfessional();
    const other = phone();
    await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP", status: "ATIVA", phoneE164: other, fullName: "Outra Profissional",
        proposalsAcceptedAt: new Date(),
        conversation: { create: { provider: "mock", state: "COMPLETED" } },
      },
    });
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    const offer = await prisma.opportunityResponse.findFirstOrThrow({
      where: { opportunity: { bookingId: conv.bookingId! }, lead: { phoneE164: first.phone } },
    });
    await receive(first.phone, `SIM ${offer.responseToken}`);
    await receive(first.phone, "desisto");
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: conv.bookingId! } });
    expect(booking.status).toBe("MATCHING");
    expect(booking.assignedProfessionalLeadId).toBeNull();
    const reopened = await prisma.serviceOpportunity.findFirstOrThrow({
      where: { bookingId: booking.id, status: "OPEN" },
      include: { responses: { include: { lead: true } } },
    });
    expect(reopened.responses.map((response) => response.lead.phoneE164)).toEqual([other]);
    expect((await sentTexts(sender)).some((text) => /não poderá mais atender/.test(text))).toBe(true);
  });

  it("when nobody accepts in time, the customer can send the request again", async () => {
    await registerProfessional();
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    const opportunity = await prisma.serviceOpportunity.findFirstOrThrow({ where: { bookingId: conv.bookingId! } });
    // O prazo só corre depois que a proposta sai da fila.
    await drainOutbox();
    await prisma.serviceOpportunity.update({ where: { id: opportunity.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireOpportunities(prisma, { opportunityId: opportunity.id });
    const reopened = await conversation(sender);
    expect(reopened.state).toBe("FINAL_CONFIRMATION");
    expect((await sentTexts(sender)).at(-1)).toMatch(/Nenhuma profissional aceitou[\s\S]*CANCELAR/);
    await receive(sender, "1");
    const again = await conversation(sender);
    expect(again.state).toBe("COMPLETED");
    expect(again.booking?.status).toBe("MATCHING");
    expect(
      await prisma.serviceOpportunity.count({ where: { bookingId: conv.bookingId!, status: "OPEN" } })
    ).toBe(1);
  });

  it("asks active professionals from before for consent once; after Sim they get offers", async () => {
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const legacy = phone();
    const lead = await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP", status: "ATIVA", phoneE164: legacy, fullName: "Profissional Antiga",
        conversation: { create: { provider: "mock", state: "COMPLETED" } },
      },
    });
    expect((await requestProposalConsentFromActiveProfessionals(prisma, { actor: "test:admin" })).requested).toBe(1);
    expect((await requestProposalConsentFromActiveProfessionals(prisma, { actor: "test:admin" })).requested).toBe(1);
    expect(
      await prisma.outboxMessage.count({ where: { idempotencyKey: `proposal-consent-request:${lead.id}` } })
    ).toBe(1);
    await receive(legacy, "1");
    const accepted = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(accepted.status).toBe("ATIVA");
    expect(accepted.proposalsAcceptedAt).not.toBeNull();
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    expect(
      await prisma.opportunityResponse.count({ where: { leadId: lead.id, opportunity: { bookingId: conv.bookingId! } } })
    ).toBe(1);
  });

  it("offers the request to a professional registered with only name and consent", async () => {
    // (proposalsAcceptedAt is the consent given on WhatsApp)
    await prisma.recruitmentLead.updateMany({ data: { status: "DESISTIU" } });
    const professional = phone();
    // Cadastro simplificado: sem bairro, área ou dias de disponibilidade.
    const lead = await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: "ATIVA",
        proposalsAcceptedAt: new Date(),
        phoneE164: professional,
        fullName: "Ana Nova",
        conversation: { create: { provider: "mock", state: "COMPLETED" } },
      },
    });
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    expect(conv.booking?.status).toBe("MATCHING");
    expect(
      await prisma.opportunityResponse.count({
        where: { leadId: lead.id, opportunity: { bookingId: conv.bookingId! } },
      })
    ).toBe(1);
  });

  it.each([
    ["{d3} as 14 h", "17:00"],
    ["{d3} às 14h", "17:00"],
    ["{d3} 14:00", "17:00"],
    ["{d3} 14hrs", "17:00"],
    ["{d3} 2 da tarde", "17:00"],
    ["{d3} 14 horas", "17:00"],
    ["3 14h", "17:00"],
    ["{d3} às 8h", "11:00"],
    // Horário livre: não há mais grade fixa de horários.
    ["{d3} 10h", "13:00"],
    ["{d3} 15h30", "18:30"],
  ])(
    "understands the PT-BR reply %s without defaulting to the first slot",
    async (template, utcTime) => {
      const sender = phone();
      for (const text of ["Oi", "1", "Maria Souza"])
        await receive(sender, text);
      const day = customerScheduleDateChoices()[2]!.label;
      await receive(sender, template.replace("{d3}", day));
      const conv = await conversation(sender);
      expect(conv.state).toBe("ADDRESS");
      expect(conv.booking?.scheduledAt?.toISOString().slice(11, 16)).toBe(
        utcTime
      );
    }
  );

  it("asks again, explaining the window, when the time is outside 6h-22h", async () => {
    const sender = phone();
    for (const text of ["Oi", "1", "Maria Souza"]) await receive(sender, text);
    await receive(sender, `${customerScheduleDateChoices()[2]!.label} às 3h`);
    const conv = await conversation(sender);
    expect(conv.state).toBe("SCHEDULE_DATE");
    expect(conv.booking?.scheduledAt).toBeNull();
    const last = (await sentTexts(sender)).at(-1)!;
    expect(last).toMatch(/3h/);
    expect(last).toContain("entre 6h e 22h");
  });

  it("exchanges contacts: customer gets the professional, professional gets the customer", async () => {
    const professional = await registerProfessional();
    const sender = await customerWithRequestSent();
    const conv = await conversation(sender);
    const offer = await prisma.opportunityResponse.findFirstOrThrow({
      where: {
        opportunity: { bookingId: conv.bookingId! },
        lead: { phoneE164: professional.phone },
      },
    });
    const offerText = (await drainOutbox())
      .filter((item) => item.recipient === professional.phone)
      .at(-1)!.text;
    expect(offerText).toContain("Bairro: Meireles");
    expect(offerText).toContain(`Detalhes: ${DETAILS}`);
    expect(offerText).not.toContain("Valor estimado");
    expect(offerText).not.toMatch(/Pagamento:/);
    // O endereço completo só vai para quem aceitar.
    expect(offerText).not.toContain("Rua Teste, 123");

    await receive(professional.phone, `SIM ${offer.responseToken}`);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: conv.bookingId! },
    });
    expect(booking.status).toBe("PROFESSIONAL_ASSIGNED");

    const afterAccept = await drainOutbox();
    const toCustomer = afterAccept
      .filter((item) => item.recipient === sender)
      .at(-1)!.text;
    expect(toCustomer).toContain("Joana Profissional");
    expect(toCustomer).toContain(professional.phone);
    expect(toCustomer).toContain("wa.me/");
    const toProfessional = afterAccept
      .filter((item) => item.recipient === professional.phone)
      .at(-1)!.text;
    expect(toProfessional).toContain("Maria Souza");
    expect(toProfessional).toContain(sender);
    expect(toProfessional).toContain("Rua Teste, 123, Meireles");
    expect(toProfessional).toContain("14:00");
    expect(toProfessional).toContain(DETAILS);
    expect(toProfessional).toMatch(/direto entre as partes/i);
  });

  it("honors PARAR at the address step and MENU resumes the same request", async () => {
    const sender = phone();
    for (const text of ["Oi", "1", "Maria Souza", "amanhã às 14h"])
      await receive(sender, text);
    const original = await conversation(sender);
    expect(original.state).toBe("ADDRESS");
    await receive(sender, "PARAR");
    expect((await conversation(sender)).state).toBe("PAUSED");
    await receive(sender, "MENU");
    const resumed = await conversation(sender);
    expect(resumed.id).toBe(original.id);
    expect(resumed.state).toBe("ADDRESS");
    expect(resumed.bookingId).toBe(original.bookingId);
  });

  it("resumes a conversation stuck in MANUAL_REVIEW by coverage on the next message", async () => {
    await registerProfessional();
    const sender = phone();
    for (const text of ["Oi", "1", "Maria Souza", "amanhã às 14h"])
      await receive(sender, text);
    const stuck = await conversation(sender);
    // Reproduces what the former coverage step left behind.
    await prisma.$transaction(async (tx) => {
      const review = await transitionBookingStatusInTransaction(tx, {
        bookingId: stuck.bookingId!,
        targetStatus: "REVIEW_REQUIRED",
        actor: "test:legacy",
      });
      if (!review.ok) throw review.error;
      await tx.booking.update({
        where: { id: stuck.bookingId! },
        data: { addressLine1: "Rua Teste, 123, Meireles", neighborhood: null },
      });
      await tx.customerBookingConversation.update({
        where: { id: stuck.id },
        data: { state: "MANUAL_REVIEW", lastQuestionKey: "MANUAL_REVIEW" },
      });
    });
    await receive(sender, "Oi, alguma novidade?");
    // Retoma pelo que falta (a descrição), sem gravar a mensagem como descrição.
    let conv = await conversation(sender);
    expect(conv.state).toBe("PROPERTY_CHARACTERISTICS");
    expect(conv.booking?.customerNotes).toBeNull();
    await receive(sender, DETAILS);
    await receive(sender, "1");
    conv = await conversation(sender);
    expect(conv.state).toBe("COMPLETED");
    expect(conv.booking?.status).toBe("MATCHING");
  });

  it("keeps a paused legacy review paused when the team validates coverage", async () => {
    const sender = phone();
    for (const text of ["Oi", "1", "Maria Souza", "amanhã às 14h"])
      await receive(sender, text);
    const original = await conversation(sender);
    await prisma.$transaction(async (tx) => {
      const review = await transitionBookingStatusInTransaction(tx, {
        bookingId: original.bookingId!,
        targetStatus: "REVIEW_REQUIRED",
        actor: "test:legacy",
      });
      if (!review.ok) throw review.error;
      await tx.booking.update({
        where: { id: original.bookingId! },
        data: { addressLine1: "Rua Teste, 123, Meireles" },
      });
      await tx.customerBookingConversation.update({
        where: { id: original.id },
        data: { state: "PAUSED", lastQuestionKey: "MANUAL_REVIEW" },
      });
    });
    const before = await prisma.outboxMessage.count({
      where: { recipient: sender },
    });
    await validateCustomerBookingCoverage(prisma, {
      bookingId: original.bookingId!,
      isCovered: true,
      actor: "test:admin",
    });
    expect((await conversation(sender)).state).toBe("PAUSED");
    expect(
      await prisma.outboxMessage.count({ where: { recipient: sender } })
    ).toBe(before);
    await receive(sender, "MENU");
    expect((await conversation(sender)).state).toBe("FINAL_CONFIRMATION");
  });

  it("deduplicates the first inbound and concurrent starts create one customer conversation", async () => {
    const sender = phone();
    const externalId = randomUUID();
    await receive(sender, "Oi", externalId);
    const count = await prisma.outboxMessage.count({
      where: { recipient: sender },
    });
    await receive(sender, "Oi", externalId);
    expect(
      await prisma.outboxMessage.count({ where: { recipient: sender } })
    ).toBe(count);
    const next = phone();
    await Promise.all(
      [1, 2].map(() =>
        startCustomerBookingConversation(prisma, {
          phoneE164: next,
          provider: "mock",
        })
      )
    );
    expect(
      await prisma.customerBookingConversation.count({
        where: { customer: { phoneE164: next } },
      })
    ).toBe(1);
  });

  it("continues through the reminder backlog and concurrent scans send each reminder once", async () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const senders = [phone(), phone(), phone()];
    for (const sender of senders) {
      const result = await startCustomerBookingConversation(prisma, {
        phoneE164: sender,
        provider: "mock",
      });
      if (!result.started) throw new Error("Fixture did not start");
      await prisma.customerBookingConversation.update({
        where: { id: result.conversation.id },
        data: { lastInboundAt: new Date("2026-12-01T12:00:00Z") },
      });
    }
    for (let i = 0; i < 3; i++)
      await reengageSilentCustomerConversations(prisma, {
        afterHours: 24,
        limit: 1,
        now,
      });
    await Promise.all(
      [1, 2].map(() =>
        reengageSilentCustomerConversations(prisma, {
          afterHours: 24,
          limit: 100,
          now,
        })
      )
    );
    expect(
      await prisma.outboxMessage.count({
        where: {
          recipient: { in: senders },
          idempotencyKey: { startsWith: "customer-reengagement:" },
        },
      })
    ).toBe(3);
  });

  it("scopes the reminder to a single conversation when conversationId is given", async () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const senderA = phone();
    const senderB = phone();
    async function createStaleConversation(sender: string) {
      const result = await startCustomerBookingConversation(prisma, {
        phoneE164: sender,
        provider: "mock",
      });
      if (!result.started) throw new Error("Fixture did not start");
      await prisma.customerBookingConversation.update({
        where: { id: result.conversation.id },
        data: { lastInboundAt: new Date("2026-12-01T12:00:00Z") },
      });
      return result.conversation.id;
    }
    const conversationIdA = await createStaleConversation(senderA);
    await createStaleConversation(senderB);

    await reengageSilentCustomerConversations(prisma, {
      afterHours: 24,
      now,
      conversationId: conversationIdA,
    });
    expect(
      await prisma.outboxMessage.count({
        where: {
          recipient: senderA,
          idempotencyKey: { startsWith: "customer-reengagement:" },
        },
      })
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: {
          recipient: senderB,
          idempotencyKey: { startsWith: "customer-reengagement:" },
        },
      })
    ).toBe(0);
  });

  it("recovers an audio already transcribed when its conversation routing was interrupted", async () => {
    const sender = phone();
    const { message } = await processInboundEvent(prisma, {
      provider: "evolution",
      externalId: randomUUID(),
      sender,
      recipient: "+5585987231727",
      payload: {
        version: 1,
        type: "AUDIO",
        externalMediaId: "audio",
        contentType: "audio/ogg",
      },
    });
    await prisma.receivedAudio.create({
      data: {
        inboundMessageId: message.id,
        storageKey: "test-audio",
        contentType: "audio/ogg",
        sizeBytes: 10,
        transcription: "Oi",
      },
    });
    const download = vi.fn();
    const transcribe = vi.fn();
    const result = await processPendingReceivedAudio(
      prisma,
      new InMemoryStorageProvider(),
      { download },
      { transcribe },
      { limit: 10 }
    );
    expect(result).toContainEqual({ inboundMessageId: message.id, ok: true });
    expect(
      (
        await prisma.inboundMessage.findUniqueOrThrow({
          where: { id: message.id },
        })
      ).processedAt
    ).not.toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("finishes professional registration with a confirmation message", async () => {
    const sender = phone();
    // Cadastro simples: menu -> nome -> aceite de propostas.
    for (const text of ["Oi", "2", "Maria", "1"]) await receive(sender, text);
    const lead = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { phoneE164: sender },
      include: { conversation: true },
    });
    expect(lead.status).toBe("ATIVA");
    expect(lead.proposalsAcceptedAt).not.toBeNull();
    expect(lead.conversation?.state).toBe("COMPLETED");
    expect((await sentTexts(sender)).at(-1)).toMatch(
      /cadastro.*(recebido|concluído)/i
    );
  });

  it("releases a failed transcription lease so the next attempt can succeed immediately", async () => {
    const sender = phone();
    const { message } = await processInboundEvent(prisma, {
      provider: "evolution",
      externalId: randomUUID(),
      sender,
      recipient: "+5585987231727",
      payload: {
        version: 1,
        type: "AUDIO",
        externalMediaId: "retry-audio",
        contentType: "audio/ogg",
      },
    });
    await prisma.receivedAudio.create({
      data: {
        inboundMessageId: message.id,
        storageKey: "retry-audio",
        contentType: "audio/ogg",
        sizeBytes: 3,
      },
    });
    const storage = new InMemoryStorageProvider();
    vi.spyOn(storage, "get").mockResolvedValue(new Uint8Array([1, 2, 3]));
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(new Error("Temporary outage"))
      .mockResolvedValueOnce({ text: "Oi", model: "whisper-1" });
    await expect(
      transcribeReceivedAudio(
        prisma,
        storage,
        { transcribe },
        { inboundMessageId: message.id }
      )
    ).rejects.toThrow("Temporary outage");
    expect(
      (
        await prisma.receivedAudio.findUniqueOrThrow({
          where: { inboundMessageId: message.id },
        })
      ).transcriptionLeaseUntil
    ).toBeNull();
    expect(
      await transcribeReceivedAudio(
        prisma,
        storage,
        { transcribe },
        { inboundMessageId: message.id }
      )
    ).toEqual({ ok: true, value: { text: "Oi", alreadyTranscribed: false } });
  });

  it("prevents an expired outbox lease from overwriting a later successful send", async () => {
    const sender = phone();
    const queued = await enqueueOutboundMessage(prisma, {
      provider: "mock",
      recipient: sender,
      payload: textPayload("Oi"),
      idempotencyKey: randomUUID(),
      actor: "test",
    });
    let rejectSend!: (reason: Error) => void;
    let markSending!: () => void;
    const sending = new Promise<void>((resolve) => {
      markSending = resolve;
    });
    const gateway = new MockMessagingAdapter();
    vi.spyOn(gateway, "send").mockImplementationOnce(async () => {
      markSending();
      return new Promise((_, reject) => {
        rejectSend = reject;
      });
    });
    const registry = new StaticMessagingGatewayRegistry([["mock", gateway]]);
    const stale = dispatchNextOutboxMessage(prisma, registry);
    await sending;
    await prisma.outboxMessage.update({
      where: { id: queued.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await prisma.messagingProviderState.update({
      where: { provider: "mock" },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect((await dispatchNextOutboxMessage(prisma, registry))?.status).toBe(
      "SENT"
    );
    rejectSend(new Error("Late failure from the old worker"));
    expect(await stale).toBeNull();
    expect(
      (
        await prisma.outboxMessage.findUniqueOrThrow({
          where: { id: queued.id },
        })
      ).status
    ).toBe("SENT");
  });
});
