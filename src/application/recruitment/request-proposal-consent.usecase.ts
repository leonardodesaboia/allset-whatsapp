import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { QUESTIONS } from "../../domain/recruitment/conversation-definition";
import { textPayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

const CONSENT_REQUEST_PREFIX =
  "Novidade na AllSet: agora os pedidos de limpeza chegam a todas as profissionais cadastradas, e quem aceitar primeiro fica com o serviço.";

/** Active professionals from before the simple signup, still without consent. */
export function professionalsAwaitingConsentWhere() {
  return {
    status: { in: ["ATIVA" as const, "PREFERENCIAL" as const] },
    phoneE164: { not: null },
    proposalsAcceptedAt: null,
  };
}

/**
 * Asks each of them, once, whether they want to receive proposals. Their reply
 * goes through the PROPOSAL_CONSENT question; until then they get no offers.
 * Messages leave at the WhatsApp interval, after conversation replies.
 */
export async function requestProposalConsentFromActiveProfessionals(
  prisma: PrismaClient,
  input: { actor: string }
): Promise<{ requested: number }> {
  const leads = await prisma.recruitmentLead.findMany({
    where: professionalsAwaitingConsentWhere(),
    include: { conversation: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  let requested = 0;
  for (const lead of leads) {
    const sent = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${lead.id} FOR UPDATE`;
      const current = await tx.recruitmentLead.findUniqueOrThrow({ where: { id: lead.id } });
      if (current.proposalsAcceptedAt || !current.phoneE164) return false;
      const conversation = await tx.recruitmentConversation.upsert({
        where: { leadId: lead.id },
        create: {
          leadId: lead.id,
          provider: env.MESSAGING_DEFAULT_PROVIDER,
          state: "PROPOSAL_CONSENT",
          lastQuestionKey: "PROPOSAL_CONSENT",
        },
        update: {
          state: "PROPOSAL_CONSENT",
          lastQuestionKey: "PROPOSAL_CONSENT",
          automationPausedAt: null,
          misunderstandingCount: 0,
        },
      });
      const queued = await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: current.phoneE164,
        payload: textPayload(`${CONSENT_REQUEST_PREFIX}\n\n${QUESTIONS.PROPOSAL_CONSENT!.text}`),
        // Once per professional: a second click never resends.
        idempotencyKey: `proposal-consent-request:${lead.id}`,
        correlationId: conversation.id,
        actor: input.actor,
        priority: -1,
      });
      await recordAuditLog(tx, {
        actor: input.actor,
        action: "PROPOSAL_CONSENT_REQUESTED",
        entityType: "RecruitmentLead",
        entityId: lead.id,
        metadata: { outboxMessageId: queued.id },
      });
      return true;
    });
    if (sent) requested += 1;
  }
  return { requested };
}
