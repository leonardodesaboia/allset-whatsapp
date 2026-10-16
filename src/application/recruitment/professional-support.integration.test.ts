import type { PrismaClient, RecruitmentStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { processContactConversationText } from "../messaging/process-contact-conversation-text.usecase";
import { getNeedsMeLeads } from "./kanban-read-model";
import { processRecruitmentAnswer } from "./conversation-engine.usecase";

describe("professional support and recruitment handoffs", () => {
  let prisma: PrismaClient;
  let stop = async () => {};
  let sequence = 0;
  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
  }, 60_000);
  afterAll(async () => stop());

  async function scene(status: RecruitmentStatus, text: string) {
    const phone = `+5585988${String(++sequence).padStart(6, "0")}`;
    const lead = await prisma.recruitmentLead.create({ data: { origin: "WHATSAPP", phoneE164: phone, status } });
    const inbound = await prisma.inboundMessage.create({ data: {
      provider: "mock", externalId: `support-${sequence}`, sender: phone, recipient: "allset", type: "TEXT",
      payload: { version: 1, type: "TEXT", text },
    } });
    return { lead, input: { inboundMessageId: inbound.id, phoneE164: phone, text, provider: "mock" } };
  }

  it.each(["ATIVA", "PREFERENCIAL", "SUSPENSA", "REPROVADA", "REFERENCIA", "PRE_APROVADA", "PRE_CADASTRO"] as const)(
    "records support without changing %s or replaying the same inbound",
    async (status) => {
      const { lead, input } = await scene(status, "falar com um atendente");
      await processContactConversationText(prisma, input);
      await processContactConversationText(prisma, input);
      const updated = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
      expect(updated.status).toBe(status);
      expect(updated.nextAction).toBe("Atender pedido de ajuda da profissional");
      expect((await getNeedsMeLeads(prisma)).some((item) => item.id === lead.id)).toBe(true);
      expect(await prisma.leadEvent.count({ where: { leadId: lead.id, type: "SUPPORT_REQUESTED" } })).toBe(1);
      expect(await prisma.leadNote.count({ where: { leadId: lead.id } })).toBe(1);
      expect(await prisma.outboxMessage.count({ where: { idempotencyKey: `professional-support:${input.inboundMessageId}` } })).toBe(1);
      expect(await prisma.recruitmentStatusHistory.count({ where: { leadId: lead.id } })).toBe(0);
    },
  );

  it.each([
    { state: "CHANNEL_PREFERENCE", text: "2", count: 0 },
    { state: "NAME", text: "não entendi", count: 1 },
  ] as const)("confirms the human handoff from $state", async ({ state, text, count }) => {
    const { lead, input } = await scene("PRE_CADASTRO", text);
    const conversation = await prisma.recruitmentConversation.create({ data: {
      leadId: lead.id, provider: "mock", state, lastQuestionKey: state, misunderstandingCount: count,
    } });
    await processRecruitmentAnswer(prisma, input);
    await processRecruitmentAnswer(prisma, input);
    expect((await prisma.recruitmentConversation.findUniqueOrThrow({ where: { id: conversation.id } })).state).toBe("PAUSED");
    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("LIGACAO_SOLICITADA");
    expect(await prisma.outboxMessage.count({ where: { correlationId: conversation.id } })).toBe(1);
  });
});
