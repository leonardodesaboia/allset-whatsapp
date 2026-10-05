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
import { startCustomerBookingConversation } from "../customer/customer-booking-conversation.usecase";
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
  async function customerAtConfirmation() {
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "1",
      "amanhã às 14h",
      "Rua Teste, 123, Meireles",
    ])
      await receive(sender, text);
    const conv = await conversation(sender);
    expect(conv.state).toBe("MANUAL_REVIEW");
    await validateCustomerBookingCoverage(prisma, {
      bookingId: conv.bookingId!,
      isCovered: true,
      actor: "test:admin",
    });
    return sender;
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

  it("asks a new customer for their name before anything else", async () => {
    const sender = phone();
    await receive(sender, "Oi");
    await receive(sender, "1");
    expect((await conversation(sender)).state).toBe("NAME");
    await receive(sender, "Maria Souza");
    const afterName = await conversation(sender);
    expect(afterName.state).toBe("PROPERTY_CHARACTERISTICS");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { phoneE164: sender } }))
        .fullName
    ).toBe("Maria Souza");
  });

  it("never asks for the name again once the customer already has one", async () => {
    const sender = await customerAtConfirmation();
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
    expect((await conversation(sender)).state).toBe("PROPERTY_CHARACTERISTICS");
    await receive(sender, "99");
    expect((await conversation(sender)).state).toBe("PROPERTY_CHARACTERISTICS");
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

  it("takes a client from the menu to payment and keeps the agreed price in the final summary", async () => {
    const sender = await customerAtConfirmation();
    await prisma.propertyPricingTier.update({
      where: { id: tierId },
      data: { priceCents: 19000 },
    });
    await receive(sender, "MENU");
    const texts = await sentTexts(sender);
    const summary = texts.at(-1)!;
    expect(summary).toContain("Rua Teste, 123, Meireles");
    expect(summary).toContain("14:00");
    expect(summary).toContain("150,00");
    expect(summary).not.toContain("190,00");
    await receive(sender, "1");
    const conv = await conversation(sender);
    expect(conv.state).toBe("AWAITING_PAYMENT");
    expect(conv.booking?.status).toBe("AWAITING_PAYMENT");
  });

  it("changes the schedule by menu without collecting an already validated address again", async () => {
    const sender = await customerAtConfirmation();
    for (const text of ["2", "2", "1", "1"]) await receive(sender, text);
    const conv = await conversation(sender);
    expect(conv.state).toBe("FINAL_CONFIRMATION");
    expect(conv.booking?.status).toBe("AWAITING_CUSTOMER_CONFIRMATION");
    expect(conv.booking?.addressLine1).toBe("Rua Teste, 123, Meireles");
  });

  it("prepares a paid WhatsApp request and assigns a professional through her reply", async () => {
    const sender = await customerAtConfirmation();
    await receive(sender, "1");
    const conv = await conversation(sender);
    const bookingId = conv.bookingId!;
    expect(conv.booking?.neighborhood).toBeNull();
    expect(conv.booking?.professionalPaymentCents).toBeNull();
    await expect(
      prepareBookingMatching(prisma, {
        bookingId,
        neighborhood: "Meireles",
        professionalPaymentCents: 10000,
        actor: "test:admin",
      })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_EDITABLE" });
    await prisma.$transaction(async (tx) => {
      const result = await transitionBookingStatusInTransaction(tx, {
        bookingId,
        targetStatus: "PAID",
        actor: "test:admin",
      });
      if (!result.ok) throw result.error;
      await tx.customerBookingConversation.update({
        where: { id: conv.id },
        data: { state: "COMPLETED" },
      });
    });
    await expect(
      prepareBookingMatching(prisma, {
        bookingId,
        neighborhood: "Meireles",
        professionalPaymentCents: 0,
        actor: "test:admin",
      })
    ).rejects.toThrow();
    await prepareBookingMatching(prisma, {
      bookingId,
      neighborhood: " Meireles ",
      professionalPaymentCents: 10000,
      actor: "test:admin",
    });
    const professional = phone();
    await prisma.recruitmentLead.create({
      data: {
        origin: "WHATSAPP",
        status: "ATIVA",
        phoneE164: professional,
        fullName: "Maria",
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
      },
    });
    expect(
      (await notifyOpportunity(prisma, { bookingId, actor: "test:admin" }))
        .dispatched
    ).toBe(true);
    const offer = await prisma.opportunityResponse.findFirstOrThrow({
      where: { opportunity: { bookingId } },
    });
    await expect(
      prepareBookingMatching(prisma, {
        bookingId,
        neighborhood: "Aldeota",
        professionalPaymentCents: 12000,
        actor: "test:admin",
      })
    ).rejects.toMatchObject({ code: "BOOKING_NOT_EDITABLE" });
    await receive(professional, `SIM ${offer.responseToken}`);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } }))
        .status
    ).toBe("PROFESSIONAL_ASSIGNED");
    expect(
      await prisma.outboxMessage.count({
        where: { recipient: sender, correlationId: offer.opportunityId },
      })
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: bookingId, action: "BOOKING_MATCHING_PREPARED" },
      })
    ).toBe(1);
  });

  it("honors PARAR during payment and MENU resumes the same request", async () => {
    const sender = await customerAtConfirmation();
    await receive(sender, "1");
    const original = await conversation(sender);
    await receive(sender, "PARAR");
    expect((await conversation(sender)).state).toBe("PAUSED");
    await receive(sender, "MENU");
    const resumed = await conversation(sender);
    expect(resumed.id).toBe(original.id);
    expect(resumed.state).toBe("AWAITING_PAYMENT");
    expect(resumed.bookingId).toBe(original.bookingId);
  });

  it("keeps a paused conversation paused when the team validates coverage", async () => {
    const sender = phone();
    for (const text of [
      "Oi",
      "1",
      "Maria Souza",
      "1",
      "amanhã às 14h",
      "Rua Teste, 123, Meireles",
      "PARAR",
    ])
      await receive(sender, text);
    const original = await conversation(sender);
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

  it("requires fresh coverage validation after an address edit", async () => {
    const sender = await customerAtConfirmation();
    const original = await conversation(sender);
    await prisma.booking.update({
      where: { id: original.bookingId! },
      data: { neighborhood: "Meireles", professionalPaymentCents: 10000 },
    });
    for (const text of ["2", "3", "Rua Nova, 456, Aldeota"])
      await receive(sender, text);
    const edited = await conversation(sender);
    expect(edited.state).toBe("MANUAL_REVIEW");
    expect(edited.booking?.coverageValidatedAt).toBeNull();
    expect(edited.booking?.neighborhood).toBeNull();
    expect(edited.booking?.professionalPaymentCents).toBeNull();
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
    for (const text of [
      "Oi",
      "2",
      "Maria",
      "Meireles",
      "sim",
      "sim",
      "segunda e terça",
    ])
      await receive(sender, text);
    const lead = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { phoneE164: sender },
      include: { conversation: true },
    });
    expect(lead.status).toBe("CONVERSA_PENDENTE");
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
