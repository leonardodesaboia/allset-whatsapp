import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processContactIntentSelection, startContactIntentConversation } from "./contact-intent-conversation.usecase";
import { processInboundEvent } from "../messaging/process-inbound-event.usecase";
import { textPayload } from "../../domain/messaging/message";

describe("contact intent conversation", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let seq = 0;

  function phone() {
    seq += 1;
    return `+5585800${String(seq).padStart(6, "0")}`;
  }

  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
  }, 60_000);

  afterAll(async () => stop());

  it("inicia uma conversa de intenção e enfileira a pergunta", async () => {
    const phoneE164 = phone();
    const result = await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });

    expect(result.state).toBe("CHOOSING_INTENT");
    expect(result.phoneE164).toBe(phoneE164);

    const enqueued = await prisma.outboxMessage.findFirst({ where: { correlationId: result.id } });
    expect(enqueued).not.toBeNull();
    expect(enqueued?.status).toBe("PENDING");
  });

  it("retorna a conversa existente sem duplicar mensagem ao reiniciar", async () => {
    const phoneE164 = phone();
    const first = await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });
    const before = await prisma.outboxMessage.count({ where: { correlationId: first.id } });
    const second = await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });

    expect(second.id).toBe(first.id);
    const after = await prisma.outboxMessage.count({ where: { correlationId: first.id } });
    expect(after).toBe(before);
  });

  it("processa seleção válida e retorna a intenção", async () => {
    const phoneE164 = phone();
    await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });
    const inbound = await processInboundEvent(prisma, {
      provider: "mock",
      externalId: `intent-${Date.now()}`,
      sender: phoneE164,
      recipient: "allset",
      payload: textPayload("1"),
    });

    const result = await processContactIntentSelection(prisma, {
      inboundMessageId: inbound.message.id,
      text: "1",
    });

    expect(result.handled).toBe(true);
    expect(result.intent).toBeDefined();
  });

  it("re-pergunta para seleção inválida", async () => {
    const phoneE164 = phone();
    await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });
    const inbound = await processInboundEvent(prisma, {
      provider: "mock",
      externalId: `intent-invalid-${Date.now()}`,
      sender: phoneE164,
      recipient: "allset",
      payload: textPayload("xyz"),
    });

    const result = await processContactIntentSelection(prisma, {
      inboundMessageId: inbound.message.id,
      text: "xyz",
    });

    expect(result.handled).toBe(true);
    expect(result.intent).toBeUndefined();
    expect(result.reason).toBe("INVALID_SELECTION");
  });

  it("inbound duplicado retorna DUPLICATE_INBOUND", async () => {
    const phoneE164 = phone();
    await startContactIntentConversation(prisma, { phoneE164, provider: "mock" });
    const inbound = await processInboundEvent(prisma, {
      provider: "mock",
      externalId: `intent-dup-${Date.now()}`,
      sender: phoneE164,
      recipient: "allset",
      payload: textPayload("1"),
    });

    await processContactIntentSelection(prisma, { inboundMessageId: inbound.message.id, text: "1" });
    const second = await processContactIntentSelection(prisma, { inboundMessageId: inbound.message.id, text: "1" });

    expect(second.handled).toBe(false);
    expect(second.reason).toBe("DUPLICATE_INBOUND");
  });

  it("retorna NOT_FOUND quando não existe conversa de intenção ativa", async () => {
    const inbound = await processInboundEvent(prisma, {
      provider: "mock",
      externalId: `intent-nofound-${Date.now()}`,
      sender: phone(),
      recipient: "allset",
      payload: textPayload("1"),
    });

    const result = await processContactIntentSelection(prisma, { inboundMessageId: inbound.message.id, text: "1" });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("NO_INTENT_CONVERSATION");
  });

  it("marca inbound como processado ao iniciar conversa", async () => {
    const phoneE164 = phone();
    const inbound = await processInboundEvent(prisma, {
      provider: "mock",
      externalId: `intent-processed-${Date.now()}`,
      sender: phoneE164,
      recipient: "allset",
      payload: textPayload("Oi"),
    });

    await startContactIntentConversation(prisma, { phoneE164, provider: "mock", inboundMessageId: inbound.message.id });

    const updated = await prisma.inboundMessage.findUniqueOrThrow({ where: { id: inbound.message.id } });
    expect(updated.processedAt).not.toBeNull();
  });
});
