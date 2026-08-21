import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { reengageSilentConversations } from "./reengage-silent-conversations.usecase";

describe("reengageSilentConversations", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let seq = 0;

  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
  }, 60_000);

  afterAll(async () => stop());

  async function makeSilentConversation({
    lastInboundHoursAgo = 48,
    reengagementCount = 0,
    state = "NAME",
  }: { lastInboundHoursAgo?: number; reengagementCount?: number; state?: string } = {}) {
    seq += 1;
    const phone = `+5585700${String(seq).padStart(6, "0")}`;
    const lead = await prisma.recruitmentLead.create({
      data: { origin: "CADASTRO_MANUAL", status: "LEAD", fullName: `Lead Reengage ${seq}`, phoneE164: phone },
    });
    const lastInboundAt = new Date(Date.now() - lastInboundHoursAgo * 60 * 60 * 1000);
    const conversation = await prisma.recruitmentConversation.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { leadId: lead.id, provider: "mock", state: state as any, reengagementCount, lastInboundAt },
    });
    return { lead, conversation, phone };
  }

  it("envia reengajamento e incrementa contador", async () => {
    const { conversation } = await makeSilentConversation();

    const result = await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 2 });

    expect(result.reengaged).toBeGreaterThanOrEqual(1);

    const updated = await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(updated.reengagementCount).toBe(1);
    expect(updated.lastReengagementAt).not.toBeNull();

    const messages = await prisma.outboxMessage.findMany({ where: { correlationId: conversation.id } });
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("não reengaja conversa ativa recentemente", async () => {
    const { conversation } = await makeSilentConversation({ lastInboundHoursAgo: 2 });

    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 2 });

    const after = await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.reengagementCount).toBe(0);
  });

  it("não reengaja quando maximumAttempts foi atingido", async () => {
    const { conversation } = await makeSilentConversation({ reengagementCount: 2 });

    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 2, conversationId: conversation.id });

    const after = await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.reengagementCount).toBe(2);
  });

  it("respeita limite de conversas por chamada", async () => {
    for (let i = 0; i < 3; i++) await makeSilentConversation();

    const result = await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 3, limit: 1 });

    expect(result.scanned).toBe(1);
  });

  it("não reengaja conversa em estado terminal (COMPLETED)", async () => {
    const { conversation } = await makeSilentConversation({ state: "COMPLETED" });

    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 2 });

    const after = await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.reengagementCount).toBe(0);
  });

  it("reengaja conversa específica por conversationId", async () => {
    const { conversation } = await makeSilentConversation();

    const result = await reengageSilentConversations(prisma, {
      afterHours: 24,
      maximumAttempts: 2,
      conversationId: conversation.id,
    });

    expect(result.reengaged).toBe(1);
  });

  it("idempotente: segunda chamada na mesma janela não reengaja", async () => {
    const { conversation } = await makeSilentConversation({ lastInboundHoursAgo: 72 });

    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 3, conversationId: conversation.id });
    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 3, conversationId: conversation.id });

    const after = await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(after.reengagementCount).toBe(1);
  });

  it("cria evento de lead e audit log para cada reengajamento", async () => {
    const { lead, conversation } = await makeSilentConversation();

    await reengageSilentConversations(prisma, { afterHours: 24, maximumAttempts: 2, conversationId: conversation.id });

    const event = await prisma.leadEvent.findFirst({ where: { leadId: lead.id, type: "REENGAGEMENT_SENT" } });
    expect(event).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { entityId: conversation.id, action: "RECRUITMENT_REENGAGEMENT_SENT" } });
    expect(audit).not.toBeNull();
  });
});
