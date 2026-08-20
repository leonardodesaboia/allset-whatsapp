import type { PrismaClient } from "@prisma/client";
import { QUESTIONS, type ConversationState } from "../../domain/recruitment/conversation-definition";
import { isEligibleForReengagement } from "../../domain/recruitment/reengagement-policy";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { enqueueRecruitmentQuestion } from "./recruitment-question-outbox";

const candidateLimit = 100;
const activeStates = Object.keys(QUESTIONS).filter((state) => state !== "INTRODUCTION") as ConversationState[];

export async function reengageSilentConversations(
  prisma: PrismaClient,
  input: { afterHours: number; maximumAttempts: number; limit?: number; now?: Date; conversationId?: string },
): Promise<{ scanned: number; reengaged: number }> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), candidateLimit);
  const cutoff = new Date(now.getTime() - input.afterHours * 60 * 60 * 1000);
  const candidates = await prisma.recruitmentConversation.findMany({
    where: {
      state: { in: activeStates },
      ...(input.conversationId ? { id: input.conversationId } : {}),
      lastInboundAt: { lte: cutoff },
      reengagementCount: { lt: input.maximumAttempts },
      OR: [{ lastReengagementAt: null }, { lastReengagementAt: { lte: cutoff } }],
    },
    orderBy: { lastInboundAt: "asc" },
    take: limit,
  });

  let reengaged = 0;
  for (const candidate of candidates) {
    const sent = await prisma.$transaction(async (tx) => {
      const conversation = await tx.recruitmentConversation.findUnique({
        where: { id: candidate.id },
        include: { lead: { select: { fullName: true, phoneE164: true } } },
      });
      if (!conversation || !conversation.lead.phoneE164 || !isEligibleForReengagement(conversation, now, input.afterHours, input.maximumAttempts)) return false;

      const claimed = await tx.recruitmentConversation.updateMany({
        where: {
          id: conversation.id,
          state: { in: activeStates },
          lastInboundAt: { lte: cutoff },
          reengagementCount: { lt: input.maximumAttempts },
          OR: [{ lastReengagementAt: null }, { lastReengagementAt: { lte: cutoff } }],
        },
        data: { lastReengagementAt: now, reengagementCount: { increment: 1 } },
      });
      if (!claimed.count) return false;

      const state = conversation.state as ConversationState;
      const question = QUESTIONS[state];
      if (!question) return false;
      const attempt = conversation.reengagementCount + 1;
      const name = conversation.lead.fullName?.trim();
      // O nudge é informativo. A pergunta seguinte mantém texto e áudio
      // equivalentes, conforme a regra de acessibilidade do fluxo.
      const nudge = `${name ? `Olá, ${name}!` : "Olá!"} Seu cadastro na AllSet ficou pela metade. Vamos retomar de onde paramos.`;
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: conversation.lead.phoneE164,
        payload: { version: 1, type: "TEXT", text: nudge },
        idempotencyKey: `reengagement:${conversation.id}:${attempt}:nudge`,
        correlationId: conversation.id,
        actor: "system:reengagement",
      });
      await enqueueRecruitmentQuestion(tx, {
        conversation,
        recipient: conversation.lead.phoneE164,
        state,
        idempotencyPrefix: `reengagement:${conversation.id}:${attempt}`,
        actor: "system:reengagement",
      });
      await tx.leadEvent.create({
        data: { leadId: conversation.leadId, type: "REENGAGEMENT_SENT", description: `Lembrete de pré-cadastro enviado (tentativa ${attempt})`, actor: "system:reengagement" },
      });
      await recordAuditLog(tx, {
        actor: "system:reengagement",
        action: "RECRUITMENT_REENGAGEMENT_SENT",
        entityType: "RecruitmentConversation",
        entityId: conversation.id,
        metadata: { attempt, state },
      });
      return true;
    });
    if (sent) reengaged += 1;
  }
  return { scanned: candidates.length, reengaged };
}
