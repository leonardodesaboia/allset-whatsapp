import type { Prisma, PrismaClient, RecruitmentLead } from "@prisma/client";
import { transitionRecruitmentStatus } from "../../domain/recruitment/recruitment-state-machine";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface TransitionLeadStatusInput { leadId: string; targetStatus: RecruitmentStatus; actor: string; reason?: string; override?: { reason: string }; }

/**
 * A column change is not sufficient evidence that a recruitment milestone was
 * completed. These checks deliberately run even for an audited override: an
 * override can recover a state transition, but cannot activate an incomplete
 * professional by accident.
 */
async function assertTransitionPrerequisites(
  tx: Prisma.TransactionClient,
  lead: RecruitmentLead,
  target: RecruitmentStatus,
): Promise<Result<true, DomainError>> {
  if (target === "REFERENCIA") {
    const completedInterview = await tx.leadInterview.count({
      where: { leadId: lead.id, endedAt: { not: null }, result: "REFERENCIA" },
    });
    if (!completedInterview) return err(new DomainError("Conclua a entrevista antes de iniciar referências", "INTERVIEW_REQUIRED"));
  }

  if (target === "PRE_APROVADA") {
    const confirmedReference = await tx.professionalReference.count({
      where: { leadId: lead.id, status: "CONFIRMED" },
    });
    if (!confirmedReference) return err(new DomainError("Confirme ao menos uma referência antes da pré-aprovação", "CONFIRMED_REFERENCE_REQUIRED"));
  }

  if (target === "ONBOARDING") {
    const requirements = await tx.documentRequirement.findMany({ where: { isActive: true, required: true }, select: { id: true } });
    const approved = requirements.length === 0 ? 0 : await tx.professionalDocument.count({
      where: { leadId: lead.id, requirementId: { in: requirements.map((requirement) => requirement.id) }, status: "APPROVED" },
    });
    if (approved !== requirements.length) return err(new DomainError("Todos os documentos obrigatórios precisam estar aprovados", "REQUIRED_DOCUMENTS_NOT_APPROVED"));

    const activeTerms = await tx.termsVersion.count({ where: { isActive: true } });
    if (activeTerms) {
      const acceptances = await tx.termsAcceptance.count({ where: { leadId: lead.id, termsVersion: { isActive: true } } });
      if (acceptances !== activeTerms) return err(new DomainError("Os termos ativos precisam ser aceitos antes do onboarding", "ACTIVE_TERMS_NOT_ACCEPTED"));
    }
  }

  if (target === "TESTE_OPERACIONAL") {
    const activeContent = await tx.onboardingContent.count({ where: { isActive: true } });
    const completedContent = await tx.leadOnboardingProgress.count({ where: { leadId: lead.id, content: { isActive: true } } });
    if (!activeContent || completedContent !== activeContent) return err(new DomainError("Conclua todo o onboarding antes do teste operacional", "ONBOARDING_NOT_COMPLETED"));
  }

  if (target === "EM_VALIDACAO") {
    const passedTest = await tx.operationalTest.count({ where: { leadId: lead.id, result: { in: ["PASSED", "PASSED_WITH_SUPPORT"] } } });
    if (!passedTest) return err(new DomainError("Um teste operacional aprovado é necessário", "PASSED_OPERATIONAL_TEST_REQUIRED"));
  }

  if (target === "ATIVA" || target === "PREFERENCIAL") {
    const policy = await tx.validationPolicy.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
    const records = await tx.validationServiceRecord.findMany({ where: { leadId: lead.id }, select: { hadIssue: true } });
    if (!policy || records.length < policy.requiredServices || records.some((record) => record.hadIssue !== false)) {
      return err(new DomainError("A validação exige os serviços mínimos sem ocorrências", "VALIDATION_NOT_ELIGIBLE"));
    }
  }

  return ok(true);
}

async function promote(tx: Prisma.TransactionClient, lead: RecruitmentLead): Promise<Result<string, DomainError>> {
  if (lead.professionalProfileId) return ok(lead.professionalProfileId);
  if (!lead.fullName || !lead.phoneE164) return err(new DomainError("Ativação exige nome e telefone", "PROMOTION_REQUIRES_CONTACT"));
  const existing = await tx.user.findUnique({ where: { phoneE164: lead.phoneE164 }, include: { professionalProfile: true } });
  if (existing?.professionalProfile) return ok(existing.professionalProfile.id);
  const user = existing ?? await tx.user.create({ data: { role: "PROFESSIONAL", fullName: lead.fullName, phoneE164: lead.phoneE164 } });
  const profile = await tx.professionalProfile.create({ data: { userId: user.id } });
  return ok(profile.id);
}

export async function transitionLeadStatusInTransaction(tx: Prisma.TransactionClient, input: TransitionLeadStatusInput): Promise<Result<RecruitmentLead, DomainError>> {
    const current = await tx.recruitmentLead.findUnique({ where: { id: input.leadId } });
    if (!current) return err(new DomainError("Lead não encontrado", "LEAD_NOT_FOUND"));
    const override = input.override;
    if (override && !override.reason.trim()) return err(new DomainError("Override exige motivo", "OVERRIDE_REASON_REQUIRED"));
    if (!override) { const valid = transitionRecruitmentStatus(current.status as RecruitmentStatus, input.targetStatus); if (!valid.ok) return err(valid.error); }
    const prerequisites = await assertTransitionPrerequisites(tx, current, input.targetStatus);
    if (!prerequisites.ok) return prerequisites;
    const requiresProfessionalProfile = input.targetStatus === "ATIVA" || input.targetStatus === "PREFERENCIAL";
    const promotion = requiresProfessionalProfile ? await promote(tx, current) : ok(current.professionalProfileId ?? "");
    if (!promotion.ok) return err(promotion.error);
    const updated = await tx.recruitmentLead.updateMany({ where: { id: current.id, version: current.version }, data: { status: input.targetStatus, version: { increment: 1 }, lastInteractionAt: new Date(), ...(requiresProfessionalProfile ? { professionalProfileId: promotion.value } : {}) } });
    if (!updated.count) return err(new DomainError("Lead alterado concorrentemente", "LEAD_CONCURRENT_MODIFICATION"));
    const reason = override?.reason ?? input.reason;
    await tx.recruitmentStatusHistory.create({ data: { leadId: current.id, fromStatus: current.status, toStatus: input.targetStatus, actor: input.actor, override: Boolean(override), ...(reason !== undefined ? { reason } : {}) } });
    await tx.leadEvent.create({ data: { leadId: current.id, type: `STATUS_${input.targetStatus}`, description: input.targetStatus === "ATIVA" ? "Ativada" : `Etapa: ${input.targetStatus}`, actor: input.actor } });
    await recordAuditLog(tx, { actor: input.actor, action: "LEAD_STATUS_TRANSITION", entityType: "RecruitmentLead", entityId: current.id, metadata: { from: current.status, to: input.targetStatus, override: Boolean(override), reason } });
    return ok(await tx.recruitmentLead.findUniqueOrThrow({ where: { id: current.id } }));
}

export async function transitionLeadStatusUseCase(prisma: PrismaClient, input: TransitionLeadStatusInput): Promise<Result<RecruitmentLead, DomainError>> {
  return prisma.$transaction((tx) => transitionLeadStatusInTransaction(tx, input));
}
