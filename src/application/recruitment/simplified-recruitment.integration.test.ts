import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import {
  startRecruitmentConversation,
  processRecruitmentAnswer,
  resumeRecruitmentConversation,
} from "./conversation-engine.usecase";
import { transitionLeadStatusUseCase } from "./transition-lead-status.usecase";
import { recruitmentAdminDecision } from "./recruitment-admin-decision.usecase";
import { getKanbanBoard } from "./kanban-read-model";
import { RECRUITMENT_STATUSES } from "../../domain/recruitment/recruitment-status";

describe("cadastro e análise simplificados", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let sequence = 0;
  const actor = "admin@recruitment.test";
  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
    await prisma.user.create({
      data: {
        email: actor,
        role: "ADMIN",
        fullName: "Admin",
        phoneE164: "+5585999999999",
      },
    });
  }, 60000);
  afterAll(async () => {
    if (stop) await stop();
  });
  async function start() {
    const phone = `+5585991${String(++sequence).padStart(6, "0")}`;
    return startRecruitmentConversation(prisma, {
      phoneE164: phone,
      provider: "test",
    });
  }
  async function answer(phone: string, text: string) {
    const message = await prisma.inboundMessage.create({
      data: {
        externalId: randomUUID(),
        provider: "test",
        sender: phone,
        recipient: "+5585999999999",
        type: "text",
        payload: { text },
      },
    });
    const result = await processRecruitmentAnswer(prisma, {
      text,
      inboundMessageId: message.id,
    });
    return { result, message };
  }
  /** Lead que concluiu o cadastro antigo e aguarda análise da equipe. */
  async function legacyTriage() {
    const { lead } = await start();
    await prisma.recruitmentConversation.update({
      where: { leadId: lead.id },
      data: { state: "COMPLETED", lastQuestionKey: "CONFIRMATION" },
    });
    return prisma.recruitmentLead.update({
      where: { id: lead.id },
      data: { status: "TRIAGEM", fullName: "Maria Silva", serviceRegions: "Caucaia e Centro" },
    });
  }
  it("pede só o nome e o aceite de propostas e já ativa a profissional", async () => {
    const { lead } = await start();
    expect((await answer(lead.phoneE164!, "Maria Silva")).result).toMatchObject({
      state: "PROPOSAL_CONSENT",
    });
    const { result, message } = await answer(lead.phoneE164!, "1");
    expect(result).toMatchObject({ completed: true, accepted: true });
    const active = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { conversation: true },
    });
    expect(active).toMatchObject({ status: "ATIVA", fullName: "Maria Silva" });
    expect(active.proposalsAcceptedAt).not.toBeNull();
    expect(active.conversation?.state).toBe("COMPLETED");
    expect(
      await processRecruitmentAnswer(prisma, {
        text: "1",
        inboundMessageId: message.id,
      })
    ).toMatchObject({ reason: "DUPLICATE_INBOUND" });
    const done = await prisma.outboxMessage.findFirstOrThrow({
      where: {
        idempotencyKey: `recruitment:${active.conversation!.id}:consent:${message.id}`,
      },
    });
    expect(done.payload).toMatchObject({
      text: expect.stringContaining("Cadastro concluído"),
    });
  });
  it("quem não aceita receber propostas fica pausada e sem aceite", async () => {
    const { lead } = await start();
    await answer(lead.phoneE164!, "Joana Lima");
    expect((await answer(lead.phoneE164!, "não quero")).result).toMatchObject({
      completed: true,
      accepted: false,
    });
    const paused = await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(paused.status).toBe("PAUSADA");
    expect(paused.proposalsAcceptedAt).toBeNull();
  });
  it("não trata dúvida como aceite", async () => {
    const { lead } = await start();
    await answer(lead.phoneE164!, "Bia Souza");
    expect((await answer(lead.phoneE164!, "acho que sim")).result).toMatchObject({
      reason: "INVALID_ANSWER",
    });
    expect(
      (await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).proposalsAcceptedAt
    ).toBeNull();
  });
  it("conversa parada numa pergunta antiga grava a resposta e segue para o aceite", async () => {
    const { lead } = await start();
    await answer(lead.phoneE164!, "Carla Dias");
    await prisma.recruitmentConversation.update({
      where: { leadId: lead.id },
      data: { state: "AVAILABILITY", lastQuestionKey: "AVAILABILITY" },
    });
    expect((await answer(lead.phoneE164!, "1 e 3")).result).toMatchObject({
      state: "PROPOSAL_CONSENT",
    });
    expect(
      (await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).availabilityDays
    ).toEqual(["Segunda a sexta de manhã", "Sábado"]);
  });
  it("não grava saudações e após duas falhas preserva pergunta para retomada", async () => {
    const { lead } = await start();
    await answer(lead.phoneE164!, "bom dia");
    await answer(lead.phoneE164!, "oi");
    const paused = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { conversation: true },
    });
    expect(paused.fullName).toBeNull();
    expect(paused.conversation?.state).toBe("MANUAL_REVIEW");
    await resumeRecruitmentConversation(prisma, { leadId: lead.id, actor });
    expect((await answer(lead.phoneE164!, "Ana Silva")).result).toMatchObject({
      state: "PROPOSAL_CONSENT",
    });
  });
  it("resgata a pergunta antiga de cobertura sem classificar por região", async () => {
    const { lead } = await start();
    await prisma.recruitmentConversation.update({
      where: { leadId: lead.id },
      data: { state: "SERVICE_AREA", lastQuestionKey: "SERVICE_AREA" },
    });
    await answer(lead.phoneE164!, "3");
    const updated = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { conversation: true },
    });
    expect(updated.status).toBe("PRE_CADASTRO");
    expect(updated.conversation?.state).toBe("REGIONS");
    expect(updated.canServeInitialArea).toBeNull();
  });
  it("agrupa todos os estados antigos sem alterar registros ou ocultar leads", async () => {
    const ids: string[] = [];
    for (const status of RECRUITMENT_STATUSES)
      ids.push(
        (
          await prisma.recruitmentLead.create({
            data: { origin: "CADASTRO_MANUAL", status },
          })
        ).id
      );
    const board = await getKanbanBoard(prisma);
    const visible = board
      .flatMap((column) => column.leads)
      .filter((lead) => ids.includes(lead.id));
    expect(visible).toHaveLength(RECRUITMENT_STATUSES.length);
    expect(new Set(visible.map((lead) => lead.status)).size).toBe(
      RECRUITMENT_STATUSES.length
    );
    expect(
      board
        .find((column) => column.status === "DOCUMENTACAO")
        ?.leads.some((lead) => lead.status === "EM_VALIDACAO")
    ).toBe(true);
  });
  it("aprovação direta e override exigem só os termos ativos, sem documentos", async () => {
    const { lead } = await start();
    await prisma.recruitmentLead.update({
      where: { id: lead.id },
      data: { status: "CONVERSA_PENDENTE", fullName: "Ana Silva" },
    });
    // Requisitos antigos continuam no banco, mas não bloqueiam mais.
    await prisma.documentRequirement.create({
      data: { key: "identity", name: "identity", required: true },
    });
    const terms = await prisma.termsVersion.create({
      data: { version: "v1", content: "Termos", isActive: true },
    });
    expect(
      await transitionLeadStatusUseCase(prisma, {
        leadId: lead.id,
        targetStatus: "ATIVA",
        actor,
        override: { reason: "Recuperação" },
      })
    ).toMatchObject({ ok: false, error: { code: "ACTIVE_TERMS_NOT_ACCEPTED" } });
    // O admin registra o aceite dos termos confirmado com a profissional.
    await prisma.termsAcceptance.create({
      data: {
        leadId: lead.id,
        termsVersionId: terms.id,
        channel: "admin-confirmed:admin",
        consentId: randomUUID(),
      },
    });
    expect(
      (
        await transitionLeadStatusUseCase(prisma, {
          leadId: lead.id,
          targetStatus: "ATIVA",
          actor,
        })
      ).ok
    ).toBe(true);
    const approved = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    expect(approved.professionalProfileId).not.toBeNull();
    expect(
      await prisma.outboxMessage.count({
        where: {
          recipient: lead.phoneE164!,
          idempotencyKey: { startsWith: "recruitment-decision:" },
        },
      })
    ).toBe(1);
  });
  it("decisões administrativas exigem motivo e detectam abas antigas sem duplicar avisos", async () => {
    const lead = await legacyTriage();
    const current = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
    });
    const decide = (action: "REJECT" | "ANALYZE", reason?: string) =>
      recruitmentAdminDecision(prisma, {
        leadId: lead.id,
        expectedVersion: current.version,
        actor,
        action,
        ...(reason ? { reason } : {}),
      });
    expect(await decide("REJECT")).toMatchObject({
      ok: false,
      error: { code: "DECISION_REASON_REQUIRED" },
    });
    expect((await decide("REJECT", "Dados não confirmados")).ok).toBe(true);
    expect(await decide("ANALYZE")).toMatchObject({
      ok: false,
      error: { code: "LEAD_CONCURRENT_MODIFICATION" },
    });
    const messages = await prisma.outboxMessage.findMany({
      where: {
        recipient: lead.phoneE164!,
        idempotencyKey: { startsWith: "recruitment-decision:" },
      },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toMatchObject({
      text: expect.stringContaining("Dados não confirmados"),
    });
  });
  it("o admin analisa e aprova direto, sem pedir documentos, e mantém a aprovação no atendimento", async () => {
    const lead = await legacyTriage();
    async function decide(action: "ANALYZE" | "APPROVE" | "CONTACT") {
      const current = await prisma.recruitmentLead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      return recruitmentAdminDecision(prisma, {
        leadId: lead.id,
        expectedVersion: current.version,
        actor,
        action,
      });
    }
    const status = async () =>
      (await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } }))
        .status;
    expect((await decide("ANALYZE")).ok).toBe(true);
    expect(await status()).toBe("CONVERSA_PENDENTE");
    // Termos ativos de outros testes precisam do aceite registrado pelo admin.
    for (const terms of await prisma.termsVersion.findMany({ where: { isActive: true } }))
      await prisma.termsAcceptance.create({
        data: {
          leadId: lead.id,
          termsVersionId: terms.id,
          channel: "admin-confirmed:admin",
          consentId: randomUUID(),
        },
      });
    expect((await decide("APPROVE")).ok).toBe(true);
    expect(await status()).toBe("ATIVA");
    const notices = await prisma.outboxMessage.findMany({
      where: {
        recipient: lead.phoneE164!,
        idempotencyKey: { startsWith: "recruitment-decision:" },
      },
    });
    expect(notices).toHaveLength(2);
    expect(
      notices.some((notice) => JSON.stringify(notice.payload).includes("documento"))
    ).toBe(false);
    expect((await decide("CONTACT")).ok).toBe(true);
    expect(await status()).toBe("ATIVA");
  });
});
