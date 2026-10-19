import type { PrismaClient } from "@prisma/client";
import {
  globalCommand,
  QUESTIONS,
} from "../../domain/recruitment/conversation-definition";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { transitionLeadStatusInTransaction } from "./transition-lead-status.usecase";

export async function processProfessionalMenu(
  prisma: PrismaClient,
  input: {
    leadId: string;
    inboundMessageId: string;
    text: string;
    provider: string;
  }
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${input.leadId} FOR UPDATE`;
    const lead = await tx.recruitmentLead.findUniqueOrThrow({
      where: { id: input.leadId },
    });
    const claimed = await tx.inboundMessage.updateMany({
      where: { id: input.inboundMessageId, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count || !lead.phoneE164) return { duplicate: true };
    const command = globalCommand(input.text);
    let text: string;
    if (command === "STOP") {
      if (lead.status !== "PAUSADA" && lead.status !== "SUSPENSA") {
        const transition = await transitionLeadStatusInTransaction(tx, {
          leadId: lead.id,
          targetStatus: "PAUSADA",
          actor: "system:professional-menu",
          reason: "Cancelou o recebimento de propostas",
        });
        if (!transition.ok) throw transition.error;
      }
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: { proposalsAcceptedAt: null },
      });
      await tx.outboxMessage.updateMany({
        where: {
          recipient: lead.phoneE164,
          status: { in: ["PENDING", "FAILED"] },
          idempotencyKey: { endsWith: ":offer" },
        },
        data: {
          status: "CANCELLED",
          lastError: "Recebimento de propostas cancelado",
        },
      });
      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          type: "PROPOSALS_WITHDRAWN",
          description: "Cancelou o recebimento de propostas pelo WhatsApp",
          actor: "system:professional-menu",
        },
      });
      text =
        "Você deixou de receber propostas. Os serviços já aceitos continuam confirmados. Para voltar a receber, envie MENU.";
    } else if (command === "HELP" || command === "PHONE") {
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: {
          nextAction: "Atender pedido de ajuda pelo WhatsApp",
          nextActionAt: new Date(),
        },
      });
      await tx.leadNote.create({
        data: {
          leadId: lead.id,
          type: "GERAL",
          content: "Solicitou ajuda pelo WhatsApp",
          author: "system:professional-menu",
        },
      });
      text =
        "Recebemos seu pedido de ajuda. Nossa equipe falará com você por aqui. Seu cadastro e os serviços já aceitos continuam como estão.";
    } else if (
      !lead.proposalsAcceptedAt &&
      !["SUSPENSA", "REPROVADA", "DESISTIU"].includes(lead.status)
    ) {
      await tx.recruitmentConversation.upsert({
        where: { leadId: lead.id },
        create: {
          leadId: lead.id,
          provider: input.provider,
          state: "PROPOSAL_CONSENT",
          lastQuestionKey: "PROPOSAL_CONSENT",
          lastInboundAt: new Date(),
        },
        update: {
          state: "PROPOSAL_CONSENT",
          lastQuestionKey: "PROPOSAL_CONSENT",
          automationPausedAt: null,
          lastInboundAt: new Date(),
          misunderstandingCount: 0,
        },
      });
      text = QUESTIONS.PROPOSAL_CONSENT!.text;
    } else {
      text =
        lead.status === "ATIVA" || lead.status === "PREFERENCIAL"
          ? "Seu cadastro está ativo. Você receberá propostas por aqui e pode escolher quais aceitar. Quem aceitar primeiro fica com o serviço. Envie PARAR para deixar de receber ou AJUDA para falar com a equipe."
          : "Seu cadastro está indisponível para receber propostas. Envie AJUDA para falar com a equipe.";
    }
    await enqueueOutboundMessage(tx, {
      provider: input.provider,
      recipient: lead.phoneE164,
      payload: textPayload(text),
      idempotencyKey: `professional-menu:${input.inboundMessageId}`,
      correlationId: lead.id,
      actor: "system:professional-menu",
    });
    return { ack: true };
  });
}
