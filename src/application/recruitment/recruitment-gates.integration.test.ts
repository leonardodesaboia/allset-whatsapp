import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { decideOperationalTest, nextOperationalTestMilestone, recordOperationalTestEvent, startOperationalTest } from "./onboarding-operational-test.usecase";
import { transitionLeadStatusUseCase } from "./transition-lead-status.usecase";
import { processRecruitmentAnswer } from "./conversation-engine.usecase";

const adminEmail = "admin:recruitment-gates@test.local";

describe("operational milestone projection", () => {
  it("derives the next milestone independently of HELP events and input order", () => {
    const events = [{ type: "HELP" }, { type: "ACCEPTED" }, { type: "STARTED" }];

    expect(nextOperationalTestMilestone(events)).toBe("EN_ROUTE");
  });
});

describe("recruitment progression gates", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;
  let sequence = 0;

  beforeAll(async () => {
    const database = await startTestDatabase();
    prisma = database.prisma;
    stop = database.stop;
    await prisma.user.create({
      data: {
        role: "ADMIN",
        fullName: "Recruitment Gates Admin",
        email: adminEmail,
        phoneE164: "+5585999999999",
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (stop) await stop();
  });

  async function leadAt(status: "DOCUMENTACAO" | "TESTE_OPERACIONAL") {
    sequence += 1;
    return prisma.recruitmentLead.create({
      data: {
        origin: "CADASTRO_MANUAL",
        status,
        fullName: `Profissional ${sequence}`,
        phoneE164: `+5585988${String(sequence).padStart(6, "0")}`,
      },
    });
  }

  async function operationalTestReadyToStart() {
    const lead = await leadAt("TESTE_OPERACIONAL");
    await prisma.onboardingContent.create({
      data: {
        key: `safety-${sequence}`,
        title: "Segurança",
        text: "Conteúdo obrigatório",
        position: sequence,
      },
    });
    const activeContents = await prisma.onboardingContent.findMany({ where: { isActive: true } });
    await prisma.leadOnboardingProgress.createMany({
      data: activeContents.map((content) => ({ leadId: lead.id, contentId: content.id, channel: "ADMIN" })),
    });
    return { lead, test: await startOperationalTest(prisma, { leadId: lead.id, actor: adminEmail }) };
  }

  it("does not approve or advance an operational test before the required execution sequence completes", async () => {
    const { lead, test } = await operationalTestReadyToStart();

    await expect(decideOperationalTest(prisma, { testId: test.id, result: "PASSED", actor: adminEmail }))
      .rejects.toMatchObject({ code: "OPERATIONAL_TEST_NOT_COMPLETED" });

    expect((await prisma.operationalTest.findUniqueOrThrow({ where: { id: test.id } })).result).toBeNull();
    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("TESTE_OPERACIONAL");
  });

  it("accepts a passed operational test only after STARTED → ACCEPTED → EN_ROUTE → ARRIVED → COMPLETED", async () => {
    const { lead, test } = await operationalTestReadyToStart();

    for (const type of ["ACCEPTED", "EN_ROUTE", "ARRIVED", "COMPLETED"] as const) {
      await recordOperationalTestEvent(prisma, { testId: test.id, type, actor: adminEmail });
    }
    await decideOperationalTest(prisma, { testId: test.id, result: "PASSED", actor: adminEmail });

    expect((await prisma.operationalTest.findUniqueOrThrow({ where: { id: test.id } })).result).toBe("PASSED");
    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("EM_VALIDACAO");
  });

  it("keeps the operational milestone sequence when HELP is recorded between milestones", async () => {
    const { lead, test } = await operationalTestReadyToStart();

    await recordOperationalTestEvent(prisma, { testId: test.id, type: "ACCEPTED", actor: adminEmail });
    await recordOperationalTestEvent(prisma, { testId: test.id, type: "HELP", actor: adminEmail });
    const eventsAfterHelp = await prisma.operationalTestEvent.findMany({
      where: { testId: test.id },
      orderBy: { createdAt: "asc" },
    });
    expect(nextOperationalTestMilestone(eventsAfterHelp)).toBe("EN_ROUTE");

    for (const type of ["EN_ROUTE", "ARRIVED", "COMPLETED"] as const) {
      await recordOperationalTestEvent(prisma, { testId: test.id, type, actor: adminEmail });
    }
    await decideOperationalTest(prisma, { testId: test.id, result: "PASSED_WITH_SUPPORT", actor: adminEmail });

    expect((await prisma.operationalTest.findUniqueOrThrow({ where: { id: test.id } }))).toMatchObject({
      result: "PASSED_WITH_SUPPORT",
      supportUsed: true,
    });
    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("EM_VALIDACAO");
  });

  it("records each operational-test milestone only once when concurrent requests arrive", async () => {
    const { test } = await operationalTestReadyToStart();

    const attempts = await Promise.allSettled([
      recordOperationalTestEvent(prisma, { testId: test.id, type: "ACCEPTED", actor: adminEmail }),
      recordOperationalTestEvent(prisma, { testId: test.id, type: "ACCEPTED", actor: adminEmail }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect(await prisma.operationalTestEvent.count({ where: { testId: test.id, type: "ACCEPTED" } })).toBe(1);
  });

  it("moves a failed operational test to a clear, recoverable status", async () => {
    const { lead, test } = await operationalTestReadyToStart();

    await decideOperationalTest(prisma, { testId: test.id, result: "FAILED", actor: adminEmail });

    expect((await prisma.operationalTest.findUniqueOrThrow({ where: { id: test.id } })).result).toBe("FAILED");
    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("AGUARDANDO_COMPLEMENTACAO");
  });

  it("blocks DOCUMENTACAO → ONBOARDING until required documents are approved and active terms are accepted", async () => {
    const lead = await leadAt("DOCUMENTACAO");
    const requirement = await prisma.documentRequirement.create({
      data: { key: `identity-${sequence}`, name: "Documento de identidade", required: true },
    });
    const terms = await prisma.termsVersion.create({
      data: { version: `v${sequence}`, content: "Termos obrigatórios", isActive: true },
    });

    const missingEvidence = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ONBOARDING",
      actor: adminEmail,
    });
    expect(missingEvidence).toMatchObject({ ok: false, error: { code: "REQUIRED_DOCUMENTS_NOT_APPROVED" } });

    await prisma.professionalDocument.create({
      data: {
        leadId: lead.id,
        requirementId: requirement.id,
        storageKey: `documents/${lead.id}/identity.pdf`,
        contentType: "application/pdf",
        sizeBytes: 10,
        status: "APPROVED",
      },
    });

    const missingTerms = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ONBOARDING",
      actor: adminEmail,
    });
    expect(missingTerms).toMatchObject({ ok: false, error: { code: "ACTIVE_TERMS_NOT_ACCEPTED" } });

    await prisma.termsAcceptance.create({
      data: {
        leadId: lead.id,
        termsVersionId: terms.id,
        channel: "WHATSAPP",
        consentId: `consent-${sequence}`,
      },
    });

    const transitioned = await transitionLeadStatusUseCase(prisma, {
      leadId: lead.id,
      targetStatus: "ONBOARDING",
      actor: adminEmail,
    });
    expect(transitioned.ok).toBe(true);
  });

  it("encaminha a escolha de ligação na preferência de canal para a fila humana", async () => {
    const lead = await prisma.recruitmentLead.create({
      data: { origin: "WHATSAPP", status: "PRE_CADASTRO", fullName: "Ligação", phoneE164: "+5585977000001" },
    });
    await prisma.recruitmentConversation.create({
      data: { leadId: lead.id, state: "CHANNEL_PREFERENCE", lastQuestionKey: "CHANNEL_PREFERENCE" },
    });
    const inbound = await prisma.inboundMessage.create({
      data: { provider: "test", externalId: `phone-choice-${sequence}`, sender: lead.phoneE164!, recipient: "+5585999999999", type: "text", payload: { text: "2" } },
    });

    await expect(processRecruitmentAnswer(prisma, { inboundMessageId: inbound.id, text: "2" }))
      .resolves.toMatchObject({ advanced: true, completed: false, state: "PAUSED" });

    expect((await prisma.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("LIGACAO_SOLICITADA");
    expect((await prisma.recruitmentConversation.findUniqueOrThrow({ where: { leadId: lead.id } })).state).toBe("PAUSED");
  });
});
