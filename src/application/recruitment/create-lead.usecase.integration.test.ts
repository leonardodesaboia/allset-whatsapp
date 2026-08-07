import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { createLeadUseCase } from "./create-lead.usecase";

describe("createLeadUseCase", () => {
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const db = await startTestDatabase();
    prisma = db.prisma;
    stop = db.stop;
  }, 60_000);

  afterAll(async () => stop());

  it("cria um lead com pré-cadastro preenchido pelo admin e grava evento + audit", async () => {
    const result = await createLeadUseCase(prisma, {
      actor: "admin:leo",
      origin: "CADASTRO_MANUAL",
      fullName: "Maria de Sousa",
      phoneE164: `+5585${Date.now()}`,
      neighborhood: "Parangaba",
      hasProfessionalExperience: true,
      experienceDuration: "GT_3Y",
      canServeInitialArea: "SIM",
      availabilityDays: ["TER", "QUI"],
      preferredCommunicationMode: "AUDIO",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lead = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: result.value.id },
    });
    expect(lead.status).toBe("LEAD");
    expect(lead.fullName).toBe("Maria de Sousa");

    const events = await prisma.leadEvent.findMany({ where: { leadId: lead.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "LEAD_CREATED", actor: "admin:leo" });

    const audit = await prisma.auditLog.findMany({ where: { entityId: lead.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "LEAD_CREATED", actor: "admin:leo" });
  });

  it("cria um lead cru só com origem (sem nome/telefone ainda)", async () => {
    const result = await createLeadUseCase(prisma, {
      actor: "admin:leo",
      origin: "WHATSAPP",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lead = await prisma.recruitmentLead.findUniqueOrThrow({
      where: { id: result.value.id },
    });
    expect(lead.fullName).toBeNull();
    expect(lead.phoneE164).toBeNull();
    expect(lead.status).toBe("LEAD");
  });
});
