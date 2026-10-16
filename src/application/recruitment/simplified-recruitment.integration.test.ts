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
  async function ready() {
    const { lead } = await start();
    for (const text of ["Maria Silva", "Caucaia e Centro", "3", "1 e 3"])
      await answer(lead.phoneE164!, text);
    return prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: lead.id },
      include: { conversation: true },
    });
  }
  it("faz quatro perguntas, pede confirmação e recebe iniciante de qualquer região", async () => {
    const lead = await ready();
    expect(lead.status).toBe("PRE_CADASTRO");
    expect(lead.conversation?.state).toBe("CONFIRMATION");
    expect(lead.availabilityDays).toEqual([
      "Segunda a sexta de manhã",
      "Sábado",
    ]);
    const summary = await prisma.outboxMessage.findMany({
      where: { recipient: lead.phoneE164! },
      orderBy: { createdAt: "desc" },
    });
    expect(summary[0]?.payload).toMatchObject({
      text: expect.stringContaining("Caucaia e Centro"),
    });
    const { result, message } = await answer(lead.phoneE164!, "1");
    expect(result).toMatchObject({ completed: true, triageTarget: "TRIAGEM" });
    expect(
      (
        await prisma.recruitmentLead.findUniqueOrThrow({
          where: { id: lead.id },
        })
      ).status
    ).toBe("TRIAGEM");
    expect(
      await processRecruitmentAnswer(prisma, {
        text: "1",
        inboundMessageId: message.id,
      })
    ).toMatchObject({ reason: "DUPLICATE_INBOUND" });
    expect(
      await prisma.outboxMessage.count({
        where: {
          idempotencyKey: `recruitment:${lead.conversation!.id}:completed`,
        },
      })
    ).toBe(1);
  });
  it.each([
    ["1", "Mariana Souza", "fullName", "Mariana Souza"],
    ["2", "Maracanaú", "serviceRegions", "Maracanaú"],
    ["3", "2", "hasInformalExperience", true],
    ["4", "4", "availabilityDays", ["Domingo"]],
  ] as const)(
    "corrige só o campo %s e volta ao resumo",
    async (choice, value, field, expected) => {
      const lead = await ready();
      await answer(lead.phoneE164!, "2");
      await answer(lead.phoneE164!, choice);
      await answer(lead.phoneE164!, value);
      const updated = await prisma.recruitmentLead.findUniqueOrThrow({
        where: { id: lead.id },
        include: { conversation: true },
      });
      expect(updated[field]).toEqual(expected);
      expect(updated.conversation?.state).toBe("CONFIRMATION");
      if (field !== "fullName") expect(updated.fullName).toBe("Maria Silva");
      await answer(lead.phoneE164!, "menu");
      const texts = await prisma.outboxMessage.findMany({
        where: { recipient: lead.phoneE164! },
        orderBy: { createdAt: "desc" },
      });
      expect(texts[0]?.payload).toMatchObject({
        text: expect.stringContaining("Confira seu cadastro"),
      });
    }
  );
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
      state: "REGIONS",
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
  it("aprovação direta e override exigem todos os documentos distintos e termos ativos", async () => {
    const { lead } = await start();
    await prisma.recruitmentLead.update({
      where: { id: lead.id },
      data: { status: "DOCUMENTACAO", fullName: "Ana Silva" },
    });
    const requirements = await Promise.all(
      ["identity", "proof"].map((key) =>
        prisma.documentRequirement.create({
          data: { key, name: key, required: true },
        })
      )
    );
    const terms = await prisma.termsVersion.create({
      data: { version: "v1", content: "Termos", isActive: true },
    });
    const move = () =>
      transitionLeadStatusUseCase(prisma, {
        leadId: lead.id,
        targetStatus: "ATIVA",
        actor,
        override: { reason: "Recuperação" },
      });
    expect(await move()).toMatchObject({
      ok: false,
      error: { code: "REQUIRED_DOCUMENTS_NOT_APPROVED" },
    });
    for (let i = 0; i < 2; i++)
      await prisma.professionalDocument.create({
        data: {
          leadId: lead.id,
          requirementId: requirements[0]!.id,
          status: "APPROVED",
          storageKey: `identity-${i}`,
          contentType: "application/pdf",
          sizeBytes: 10,
        },
      });
    expect(await move()).toMatchObject({
      ok: false,
      error: { code: "REQUIRED_DOCUMENTS_NOT_APPROVED" },
    });
    await prisma.professionalDocument.create({
      data: {
        leadId: lead.id,
        requirementId: requirements[1]!.id,
        status: "APPROVED",
        storageKey: "proof",
        contentType: "application/pdf",
        sizeBytes: 10,
      },
    });
    expect(await move()).toMatchObject({
      ok: false,
      error: { code: "ACTIVE_TERMS_NOT_ACCEPTED" },
    });
    await prisma.termsAcceptance.create({
      data: {
        leadId: lead.id,
        termsVersionId: terms.id,
        channel: "WHATSAPP",
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
    const lead = await ready();
    await answer(lead.phoneE164!, "1");
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
  it("percorre análise/documentos, repete pedido em etapa antiga e mantém aprovação no atendimento", async () => {
    const lead = await ready();
    await answer(lead.phoneE164!, "1");
    async function decide(
      action: "ANALYZE" | "REQUEST_DOCUMENT" | "CONTACT",
      reason?: string
    ) {
      const current = await prisma.recruitmentLead.findUniqueOrThrow({
        where: { id: lead.id },
      });
      return recruitmentAdminDecision(prisma, {
        leadId: lead.id,
        expectedVersion: current.version,
        actor,
        action,
        ...(reason ? { reason } : {}),
      });
    }
    expect((await decide("ANALYZE")).ok).toBe(true);
    expect(
      (await decide("REQUEST_DOCUMENT", "Documento de identidade")).ok
    ).toBe(true);
    expect(
      (
        await prisma.recruitmentLead.findUniqueOrThrow({
          where: { id: lead.id },
        })
      ).status
    ).toBe("DOCUMENTACAO");
    const requests = await prisma.outboxMessage.findMany({
      where: {
        recipient: lead.phoneE164!,
        idempotencyKey: { startsWith: "recruitment-decision:" },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.payload).toMatchObject({
      text: expect.stringContaining("Documento de identidade"),
    });
    // Legacy stage remains intact when asking for a replacement document.
    await prisma.recruitmentLead.update({
      where: { id: lead.id },
      data: { status: "ONBOARDING" },
    });
    expect(
      (await decide("REQUEST_DOCUMENT", "Foto legível do documento")).ok
    ).toBe(true);
    expect(
      (
        await prisma.recruitmentLead.findUniqueOrThrow({
          where: { id: lead.id },
        })
      ).status
    ).toBe("ONBOARDING");
    await prisma.recruitmentLead.update({
      where: { id: lead.id },
      data: { status: "ATIVA" },
    });
    expect((await decide("CONTACT")).ok).toBe(true);
    expect(
      (
        await prisma.recruitmentLead.findUniqueOrThrow({
          where: { id: lead.id },
        })
      ).status
    ).toBe("ATIVA");
  });
});
