import { Prisma } from "@prisma/client";
import type { LeadOrigin, PrismaClient, RecruitmentLead } from "@prisma/client";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface CreateLeadInput {
  actor: string;
  origin: LeadOrigin;
  phoneE164?: string; fullName?: string; neighborhood?: string; campaign?: string;
  preferredCommunicationMode?: "TEXT" | "AUDIO" | "PHONE" | "MIXED";
  hasProfessionalExperience?: boolean; experienceDuration?: "LT_1Y" | "Y1_3" | "GT_3Y" | "BY_AUDIO";
  canServeInitialArea?: "SIM" | "TALVEZ" | "NAO"; availabilityDays?: string[];
}

export async function createLeadUseCase(prisma: PrismaClient, input: CreateLeadInput): Promise<Result<RecruitmentLead, DomainError>> {
  try {
    return await prisma.$transaction(async (tx) => {
    const lead = await tx.recruitmentLead.create({
      data: {
        origin: input.origin, lastInteractionAt: new Date(),
        ...(input.phoneE164 !== undefined ? { phoneE164: input.phoneE164 } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.neighborhood !== undefined ? { neighborhood: input.neighborhood } : {}),
        ...(input.campaign !== undefined ? { campaign: input.campaign } : {}),
        ...(input.preferredCommunicationMode !== undefined ? { preferredCommunicationMode: input.preferredCommunicationMode } : {}),
        ...(input.hasProfessionalExperience !== undefined ? { hasProfessionalExperience: input.hasProfessionalExperience } : {}),
        ...(input.experienceDuration !== undefined ? { experienceDuration: input.experienceDuration } : {}),
        ...(input.canServeInitialArea !== undefined ? { canServeInitialArea: input.canServeInitialArea } : {}),
        ...(input.availabilityDays !== undefined ? { availabilityDays: input.availabilityDays as Prisma.InputJsonValue } : {}),
      },
    });
    await tx.leadEvent.create({ data: { leadId: lead.id, type: "LEAD_CREATED", description: "Lead criado", actor: input.actor } });
    await recordAuditLog(tx, { actor: input.actor, action: "LEAD_CREATED", entityType: "RecruitmentLead", entityId: lead.id, metadata: { origin: lead.origin } });
      return ok(lead);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return err(new DomainError("Telefone já cadastrado", "PHONE_ALREADY_EXISTS"));
    }
    throw error;
  }
}
