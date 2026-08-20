"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { LeadOrigin } from "@prisma/client";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { addLeadNote } from "@/application/recruitment/lead-notes.usecase";
import { resumeRecruitmentConversation } from "@/application/recruitment/conversation-engine.usecase";
import { createLeadUseCase } from "@/application/recruitment/create-lead.usecase";
import { transitionLeadStatusUseCase } from "@/application/recruitment/transition-lead-status.usecase";
import { addAssessment, addProfessionalReference, completeInterview, startInterview, verifyReference } from "@/application/recruitment/interviews-references.usecase";
import { reviewProfessionalDocument } from "@/application/recruitment/documents-terms.usecase";
import { acceptTerms } from "@/application/recruitment/documents-terms.usecase";
import { completeOnboardingContent, startOperationalTest, decideOperationalTest, recordOperationalTestEvent } from "@/application/recruitment/onboarding-operational-test.usecase";
import { recordValidationService, decideValidation } from "@/application/recruitment/validation-activation.usecase";
import type { AssessmentLevel, InterviewResult, OperationalTestResult, ReferenceStatus, WouldHireAgain } from "@prisma/client";
import { RECRUITMENT_STATUSES, type RecruitmentStatus } from "@/domain/recruitment/recruitment-status";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/shared/domain-error";

async function currentActor(): Promise<string | null> { const session = await auth.api.getSession({ headers: await headers() }); const email = session?.user.email; if (!email) return null; const user = await prisma.user.findFirst({ where: { email, role: "ADMIN" } }); return user?.email ?? null; }
const result = (ok: boolean, error?: string) => (error === undefined ? { ok } : { ok, error });
const actionError = (error: unknown, fallback: string) => error instanceof DomainError ? error.message : fallback;
const optionalTrimmed = (max: number) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value,
  z.string().max(max).optional(),
);
const createLeadSchema = z.object({
  origin: z.enum(["META_ADS", "INSTAGRAM", "FACEBOOK", "INDICACAO_PROFISSIONAL", "INDICACAO_CLIENTE", "IDT", "PARCEIRO", "ORGANICO", "WHATSAPP", "CADASTRO_MANUAL", "OUTRO"]),
  fullName: optionalTrimmed(120),
  phoneE164: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value,
    z.string().regex(/^\+[1-9]\d{7,14}$/, "Telefone deve usar o formato internacional, por exemplo +5585999999999").optional(),
  ),
  neighborhood: optionalTrimmed(100),
});
const uuidField = z.string().uuid("Identificador inválido.");
const moveLeadSchema = z.object({
  leadId: uuidField,
  targetStatus: z.enum(RECRUITMENT_STATUSES),
});
const quickNoteSchema = z.object({
  leadId: uuidField,
  content: z.string().trim().min(1, "A nota não pode ficar vazia.").max(2_000, "A nota pode ter no máximo 2.000 caracteres."),
});
const completeInterviewSchema = z.object({
  interviewId: uuidField,
  result: z.enum(["APPROVED", "REJECTED", "RESCHEDULED", "NO_SHOW"] as [string, ...string[]]),
  notes: optionalTrimmed(2_000),
});
const verifyReferenceSchema = z.object({
  referenceId: uuidField,
  leadId: uuidField,
  status: z.enum(["PENDING", "CONTACTED", "CONFIRMED", "INCONCLUSIVE", "NEGATIVE"] as [string, ...string[]]),
  comment: optionalTrimmed(2_000),
  wouldHireAgain: z.enum(["YES", "NO", "UNSURE"] as [string, ...string[]]).optional(),
});
const reviewDocumentSchema = z.object({
  documentId: uuidField,
  leadId: uuidField,
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: optionalTrimmed(500),
});
const decideValidationSchema = z.object({
  leadId: uuidField,
  decision: z.enum(["ATIVA", "PAUSADA", "REPROVADA", "PREFERENCIAL"]),
  reason: optionalTrimmed(500),
});
const recordValidationSchema = z.object({
  leadId: uuidField,
  externalServiceId: z.string().trim().min(1).max(120),
  rating: z.number().int().min(1).max(5).optional(),
  wasOnTime: z.boolean().optional(),
  hadIssue: z.boolean().optional(),
  wouldHireAgain: z.enum(["YES", "NO", "UNSURE"]).optional(),
});
const workflowManagedStatuses = new Set<RecruitmentStatus>(["ENTREVISTA", "REFERENCIA", "EM_VALIDACAO"]);
export async function moveLeadAction(input: { leadId: string; targetStatus: RecruitmentStatus }) {
  const actor = await currentActor();
  if (!actor) return result(false, "Sessão expirada.");
  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success) return result(false, "Dados da movimentação inválidos.");
  if (workflowManagedStatuses.has(parsed.data.targetStatus)) return result(false, "Use a ação específica da etapa para preservar o histórico operacional.");
  const moved = await transitionLeadStatusUseCase(prisma, { ...parsed.data, actor });
  revalidatePath("/admin/recruitment");
  return moved.ok ? result(true) : result(false, moved.error.message);
}
export async function addQuickNoteAction(input: { leadId: string; content: string }) {
  const actor = await currentActor();
  if (!actor) return result(false, "Sessão expirada.");
  const parsed = quickNoteSchema.safeParse(input);
  if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados da nota inválidos.");
  const note = await addLeadNote(prisma, { ...parsed.data, author: actor });
  revalidatePath("/admin/recruitment");
  return note.ok ? result(true) : result(false, note.error.message);
}
export async function createLeadAction(input: { origin: LeadOrigin; fullName?: string; phoneE164?: string; neighborhood?: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = createLeadSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados do cadastro inválidos."); const lead = await createLeadUseCase(prisma, { actor, origin: parsed.data.origin, ...(parsed.data.fullName !== undefined ? { fullName: parsed.data.fullName } : {}), ...(parsed.data.phoneE164 !== undefined ? { phoneE164: parsed.data.phoneE164 } : {}), ...(parsed.data.neighborhood !== undefined ? { neighborhood: parsed.data.neighborhood } : {}) }); revalidatePath("/admin/recruitment"); return lead.ok ? result(true) : result(false, lead.error.message); }
export async function resumeRecruitmentConversationAction(leadId: string) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await resumeRecruitmentConversation(prisma, { leadId, actor }); revalidatePath("/admin/recruitment"); revalidatePath(`/admin/recruitment/${leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível retomar a conversa.")); } }
export async function startInterviewAction(leadId: string) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await startInterview(prisma, { leadId, interviewer: actor }); revalidatePath(`/admin/recruitment/${leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível iniciar entrevista.")); } }
export async function completeInterviewAction(input: { interviewId: string; result: InterviewResult; notes?: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = completeInterviewSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados da entrevista inválidos."); try { const interview = await completeInterview(prisma, { ...parsed.data as typeof input, interviewer: actor }); revalidatePath(`/admin/recruitment/${interview.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível concluir entrevista.")); } }
export async function addReferenceAction(input: { leadId: string; name: string; phoneE164?: string; relationship?: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await addProfessionalReference(prisma, { ...input, author: actor }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível adicionar referência.")); } }
export async function verifyReferenceAction(input: { referenceId: string; leadId: string; status: ReferenceStatus; comment?: string; wouldHireAgain?: WouldHireAgain }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = verifyReferenceSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados da referência inválidos."); try { await verifyReference(prisma, { ...parsed.data as typeof input, verifiedBy: actor }); revalidatePath(`/admin/recruitment/${parsed.data.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível verificar referência.")); } }
export async function addAssessmentAction(input: { leadId: string; notes?: string; experience?: AssessmentLevel; reliability?: AssessmentLevel; communication?: AssessmentLevel; availability?: AssessmentLevel }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await addAssessment(prisma, { ...input, author: actor }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar avaliação.")); } }
export async function reviewDocumentAction(input: { documentId: string; leadId: string; status: "APPROVED" | "REJECTED"; reason?: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = reviewDocumentSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados do documento inválidos."); try { await reviewProfessionalDocument(prisma, { ...parsed.data as typeof input, reviewer: actor }); revalidatePath(`/admin/recruitment/${parsed.data.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível revisar documento.")); } }
export async function confirmTermsAcceptanceAction(input: { leadId: string; termsVersionId: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = z.object({ leadId: z.string().uuid(), termsVersionId: z.string().uuid() }).safeParse(input); if (!parsed.success) return result(false, "Dados de aceite inválidos."); try { await acceptTerms(prisma, { ...parsed.data, channel: `admin-confirmed:${actor}`, consentId: `admin-confirmed:${randomUUID()}` }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar o aceite.")); } }
export async function completeOnboardingContentAction(input: { leadId: string; contentId: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await completeOnboardingContent(prisma, { ...input, channel: "admin", actor }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar conclusão.")); } }
export async function startOperationalTestAction(leadId: string) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await startOperationalTest(prisma, { leadId, actor }); revalidatePath(`/admin/recruitment/${leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível iniciar teste.")); } }
export async function recordOperationalTestEventAction(input: { testId: string; leadId: string; type: "ACCEPTED" | "EN_ROUTE" | "ARRIVED" | "COMPLETED" | "HELP" }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await recordOperationalTestEvent(prisma, { ...input, actor }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar a etapa do teste.")); } }
export async function decideOperationalTestAction(input: { testId: string; leadId: string; result: OperationalTestResult }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); try { await decideOperationalTest(prisma, { testId: input.testId, result: input.result, actor }); revalidatePath(`/admin/recruitment/${input.leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível decidir teste.")); } }
export async function recordValidationServiceAction(input: { leadId: string; externalServiceId: string; rating?: number; wasOnTime?: boolean; hadIssue?: boolean; wouldHireAgain?: "YES" | "NO" | "UNSURE" }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = recordValidationSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados do serviço inválidos."); const { leadId, externalServiceId, rating, wasOnTime, hadIssue, wouldHireAgain } = parsed.data; try { await recordValidationService(prisma, { actor, leadId, externalServiceId, ...(rating !== undefined ? { rating } : {}), ...(wasOnTime !== undefined ? { wasOnTime } : {}), ...(hadIssue !== undefined ? { hadIssue } : {}), ...(wouldHireAgain !== undefined ? { wouldHireAgain } : {}) }); revalidatePath(`/admin/recruitment/${leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar serviço.")); } }
export async function decideValidationAction(input: { leadId: string; decision: "ATIVA" | "PAUSADA" | "REPROVADA" | "PREFERENCIAL"; reason?: string }) { const actor = await currentActor(); if (!actor) return result(false, "Sessão expirada."); const parsed = decideValidationSchema.safeParse(input); if (!parsed.success) return result(false, parsed.error.issues[0]?.message ?? "Dados da decisão inválidos."); const { leadId, decision, reason } = parsed.data; try { await decideValidation(prisma, { actor, leadId, decision, ...(reason !== undefined ? { reason } : {}) }); revalidatePath(`/admin/recruitment/${leadId}`); return result(true); } catch (error) { return result(false, actionError(error, "Não foi possível registrar decisão.")); } }
