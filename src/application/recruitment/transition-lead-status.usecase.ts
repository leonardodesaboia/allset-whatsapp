import type { Prisma, PrismaClient, RecruitmentLead } from "@prisma/client";
import { transitionRecruitmentStatus } from "../../domain/recruitment/recruitment-state-machine";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface TransitionLeadStatusInput { leadId: string; targetStatus: RecruitmentStatus; actor: string; reason?: string; override?: { reason: string }; }

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
    const promotion = input.targetStatus === "ATIVA" ? await promote(tx, current) : ok(current.professionalProfileId ?? "");
    if (!promotion.ok) return err(promotion.error);
    const updated = await tx.recruitmentLead.updateMany({ where: { id: current.id, version: current.version }, data: { status: input.targetStatus, version: { increment: 1 }, lastInteractionAt: new Date(), ...(input.targetStatus === "ATIVA" ? { professionalProfileId: promotion.value } : {}) } });
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
