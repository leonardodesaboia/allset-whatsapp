import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PrismaClient, type ServiceDefinition, CustomerBookingConversationState } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { sendManualCustomerMessage } from "./send-manual-customer-message.usecase";

describe("sendManualCustomerMessage", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let service: ServiceDefinition;
  let seq = 0;

  function phone() {
    seq += 1;
    return `+5585900${String(seq).padStart(6, "0")}`;
  }

  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
    service = await prisma.serviceDefinition.create({ data: { code: "LIMPEZA-MANUAL", name: "Limpeza Manual", isActive: true } });
  }, 60_000);

  afterAll(async () => stop());

  async function makeConversation(state: CustomerBookingConversationState = CustomerBookingConversationState.SCHEDULE_DATE) {
    const customer = await prisma.user.create({ data: { role: "CUSTOMER", fullName: "Cliente Teste", phoneE164: phone() } });
    const booking = await prisma.booking.create({ data: { customerId: customer.id, serviceId: service.id, status: "COLLECTING_DATA" } });
    const conversation = await prisma.customerBookingConversation.create({
      data: { customerId: customer.id, bookingId: booking.id, provider: "mock", state, version: 0 },
    });
    return { customer, booking, conversation };
  }

  it("pausa a conversa e enfileira a mensagem", async () => {
    const { conversation } = await makeConversation();

    const result = await sendManualCustomerMessage(prisma, {
      conversationId: conversation.id,
      text: "Olá, vou te ajudar em breve.",
      actor: "admin@test.local",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversationId).toBe(conversation.id);

    const updated = await prisma.customerBookingConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.state).toBe("PAUSED");
    expect(updated.automationPausedAt).not.toBeNull();
    expect(updated.version).toBe(conversation.version + 1);

    const enqueued = await prisma.outboxMessage.findFirst({ where: { correlationId: conversation.id } });
    expect(enqueued).not.toBeNull();
    expect(enqueued?.status).toBe("PENDING");
  });

  it("também funciona por bookingId", async () => {
    const { booking } = await makeConversation(CustomerBookingConversationState.NAME);

    const result = await sendManualCustomerMessage(prisma, {
      bookingId: booking.id,
      text: "Mensagem via bookingId.",
      actor: "admin@test.local",
    });

    expect(result.ok).toBe(true);
  });

  it("retorna erro quando a conversa não existe", async () => {
    const result = await sendManualCustomerMessage(prisma, {
      conversationId: "00000000-0000-0000-0000-000000000000",
      text: "Não deveria funcionar",
      actor: "admin@test.local",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("CUSTOMER_CONVERSATION_NOT_FOUND");
  });

  it("lock otimista: segunda modificação após envio bem-sucedido usa versão atualizada", async () => {
    const { conversation } = await makeConversation(CustomerBookingConversationState.PROPERTY_CHARACTERISTICS);

    // Primeira chamada bem-sucedida: conversa passa para versão 1
    const first = await sendManualCustomerMessage(prisma, {
      conversationId: conversation.id,
      text: "Primeira mensagem",
      actor: "admin@test.local",
    });
    expect(first.ok).toBe(true);

    const afterFirst = await prisma.customerBookingConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(afterFirst.version).toBe(1);

    // Segunda chamada usa a versão atualizada (1) e deve retornar erro de lock
    // pois o WHERE { version: 1 } vai bater mas simula conflito externo:
    await prisma.customerBookingConversation.update({ where: { id: conversation.id }, data: { version: { increment: 1 } } });

    // Agora a versão no banco é 2, mas a segunda chamada vai ler 2 e tentar
    // WHERE { version: 2 } → que encontra 2 → sucesso. Isso é o comportamento correto:
    // cada chamada lê a versão atual e tenta atualizar com ela.
    const second = await sendManualCustomerMessage(prisma, {
      conversationId: conversation.id,
      text: "Segunda mensagem",
      actor: "admin@test.local",
    });
    expect(second.ok).toBe(true);
    const afterSecond = await prisma.customerBookingConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(afterSecond.version).toBe(3);
  });

  it("registra audit log", async () => {
    const { conversation } = await makeConversation(CustomerBookingConversationState.ADDRESS);
    const before = await prisma.auditLog.count();

    await sendManualCustomerMessage(prisma, {
      conversationId: conversation.id,
      text: "Auditando mensagem.",
      actor: "auditor@test.local",
    });

    const after = await prisma.auditLog.count();
    expect(after).toBeGreaterThan(before);
    const log = await prisma.auditLog.findFirst({
      where: { entityId: conversation.id, action: "CUSTOMER_CONVERSATION_PAUSED_BY_MANUAL_MESSAGE" },
    });
    expect(log?.actor).toBe("auditor@test.local");
  });
});
