import { recruitmentColumn } from "../../domain/recruitment/recruitment-pipeline";
import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { textPayload } from "../../domain/messaging/message";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { transitionLeadStatusInTransaction } from "./transition-lead-status.usecase";

export type RecruitmentDecision =
  "ANALYZE" | "REQUEST_DOCUMENT" | "APPROVE" | "REJECT" | "FUTURE" | "CONTACT";
export async function recruitmentAdminDecision(
  prisma: PrismaClient,
  input: {
    leadId: string;
    expectedVersion: number;
    action: RecruitmentDecision;
    actor: string;
    reason?: string;
  }
) {
  const admin = await prisma.user.findFirst({
    where: { email: input.actor, role: "ADMIN" },
    select: { id: true },
  });
  if (!admin)
    return err(
      new DomainError("Acesso administrativo necessário", "ADMIN_REQUIRED")
    );
  const reason = input.reason?.trim();
  if (
    ["REJECT", "FUTURE", "REQUEST_DOCUMENT"].includes(input.action) &&
    !reason
  )
    return err(
      new DomainError(
        "Informe o motivo ou o documento necessário",
        "DECISION_REASON_REQUIRED"
      )
    );
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${input.leadId} FOR UPDATE`;
    const lead = await tx.recruitmentLead.findUnique({
      where: { id: input.leadId },
      include: { conversation: true },
    });
    if (!lead)
      return err(
        new DomainError("Profissional não encontrada", "LEAD_NOT_FOUND")
      );
    if (lead.version !== input.expectedVersion)
      return err(
        new DomainError(
          "O cadastro mudou. Atualize a página antes de decidir.",
          "LEAD_CONCURRENT_MODIFICATION"
        )
      );
    if (
      input.action === "CONTACT" ||
      (input.action === "REQUEST_DOCUMENT" &&
        recruitmentColumn(lead.status) === "DOCUMENTACAO")
    ) {
      if (!lead.phoneE164)
        return err(
          new DomainError(
            "Cadastre o telefone para falar com ela",
            "PROMOTION_REQUIRES_CONTACT"
          )
        );
      const updated = await tx.recruitmentLead.updateMany({
        where: { id: lead.id, version: input.expectedVersion },
        data: {
          version: { increment: 1 },
          lastInteractionAt: new Date(),
          nextAction:
            input.action === "CONTACT"
              ? "Continuar atendimento pelo WhatsApp"
              : `Aguardar documento: ${reason}`,
          nextActionAt: new Date(),
        },
      });
      if (!updated.count)
        return err(
          new DomainError(
            "O cadastro mudou. Atualize a página.",
            "LEAD_CONCURRENT_MODIFICATION"
          )
        );
      if (
        input.action === "CONTACT" &&
        lead.conversation &&
        !["COMPLETED", "PAUSED", "MANUAL_REVIEW"].includes(
          lead.conversation.state
        )
      ) {
        await tx.recruitmentConversation.update({
          where: { id: lead.conversation.id },
          data: { state: "PAUSED", automationPausedAt: new Date() },
        });
      }
      await enqueueOutboundMessage(tx, {
        provider: lead.conversation?.provider ?? env.MESSAGING_DEFAULT_PROVIDER,
        recipient: lead.phoneE164,
        payload: textPayload(
          input.action === "CONTACT"
            ? "Nossa equipe recebeu seu cadastro e vai continuar o atendimento com você por aqui. As perguntas automáticas estão pausadas."
            : `Precisamos deste documento ou ajuste para continuar seu cadastro: ${reason}. Nossa equipe vai combinar por aqui como recebê-lo. Aguarde a orientação antes de enviar arquivos.`
        ),
        idempotencyKey: `recruitment-admin:${lead.id}:${lead.version + 1}`,
        correlationId: lead.id,
        actor: input.actor,
      });
      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          type: input.action,
          description: reason ?? "Atendimento humano iniciado",
          actor: input.actor,
        },
      });
      await recordAuditLog(tx, {
        actor: input.actor,
        action: input.action,
        entityType: "RecruitmentLead",
        entityId: lead.id,
        metadata: { reason },
      });
      return ok(true);
    }
    const targetStatus = (
      {
        ANALYZE: "CONVERSA_PENDENTE",
        REQUEST_DOCUMENT: "DOCUMENTACAO",
        APPROVE: "ATIVA",
        REJECT: "REPROVADA",
        FUTURE: "BASE_FUTURA",
      } as const
    )[input.action];
    const transitioned = await transitionLeadStatusInTransaction(tx, {
      leadId: lead.id,
      targetStatus,
      actor: input.actor,
      ...(reason ? { reason } : {}),
    });
    if (!transitioned.ok) return transitioned;
    await tx.recruitmentLead.update({
      where: { id: lead.id },
      data: {
        nextAction:
          targetStatus === "DOCUMENTACAO"
            ? `Aguardar documento: ${reason}`
            : targetStatus === "CONVERSA_PENDENTE"
              ? "Conferir cadastro e solicitar documentos"
              : null,
        nextActionAt: ["DOCUMENTACAO", "CONVERSA_PENDENTE"].includes(
          targetStatus
        )
          ? new Date()
          : null,
      },
    });
    return ok(true);
  });
}
