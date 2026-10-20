import type { PrismaClient } from "@prisma/client";
import {
  globalCommand,
  QUESTIONS,
} from "../../domain/recruitment/conversation-definition";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { transitionLeadStatusInTransaction } from "./transition-lead-status.usecase";
import { normalizeAnswer } from "../../domain/recruitment/conversation-definition";
import { notifyOpportunityInTransaction } from "../marketplace/notify-opportunity.usecase";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { formatScheduleForCustomer } from "../../domain/customer/customer-booking-summary";
import type { Prisma, RecruitmentLead } from "@prisma/client";

const WITHDRAW_COMMANDS = ["DESISTO", "DESISTIR", "QUERO DESISTIR", "NAO VOU PODER", "NAO POSSO MAIS", "NAO VOU CONSEGUIR"];

/**
 * Her next service not yet confirmed by the team goes back to distribution
 * without her, and the customer is told. Returns the reply to the professional.
 */
async function withdrawFromAcceptedService(
  tx: Prisma.TransactionClient,
  lead: RecruitmentLead
): Promise<string> {
  const now = new Date();
  const booking = await tx.booking.findFirst({
    where: {
      assignedProfessionalLeadId: lead.id,
      status: "PROFESSIONAL_ASSIGNED",
      scheduledAt: { gt: now },
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      customer: { select: { phoneE164: true } },
      customerConversation: { select: { provider: true } },
    },
  });
  if (!booking?.scheduledAt) {
    const confirmed = await tx.booking.count({
      where: {
        assignedProfessionalLeadId: lead.id,
        status: { in: ["SCHEDULED", "PROFESSIONAL_CONFIRMED", "PROFESSIONAL_EN_ROUTE"] },
        scheduledAt: { gt: now },
      },
    });
    return confirmed
      ? "Esse serviço já foi confirmado com a equipe. Envie AJUDA para falarmos com você."
      : "Você não tem nenhum serviço aceito para desistir.";
  }
  const released = await tx.booking.updateMany({
    where: { id: booking.id, version: booking.version, assignedProfessionalLeadId: lead.id },
    data: { assignedProfessionalLeadId: null, version: { increment: 1 } },
  });
  if (!released.count) throw new Error("Booking alterado concorrentemente");
  await tx.leadEvent.create({
    data: {
      leadId: lead.id,
      type: "SERVICE_WITHDRAWN",
      description: `Desistiu do serviço de ${formatScheduleForCustomer(booking.scheduledAt)}`,
      actor: "system:professional-menu",
    },
  });
  if (booking.customer.phoneE164) {
    await enqueueOutboundMessage(tx, {
      provider: booking.customerConversation?.provider ?? "whatsmiau",
      recipient: booking.customer.phoneE164,
      payload: textPayload(
        `${lead.fullName ?? "A profissional"} não poderá mais atender seu pedido de ${formatScheduleForCustomer(booking.scheduledAt)}. Já estamos procurando outra profissional e avisaremos por aqui. Se preferir, responda CANCELAR.`
      ),
      idempotencyKey: `professional-withdrawal:${booking.id}:${lead.id}`,
      correlationId: booking.id,
      actor: "system:professional-menu",
    });
  }
  const result = await notifyOpportunityInTransaction(tx, {
    bookingId: booking.id,
    actor: "system:professional-withdrawal",
    excludeLeadIds: [lead.id],
  });
  if (!result.dispatched) {
    // Sem ninguém para reoferecer agora: o pedido fica visível para a equipe.
    for (const targetStatus of ["MATCHING", "REVIEW_REQUIRED"] as const) {
      const moved = await transitionBookingStatusInTransaction(tx, {
        bookingId: booking.id,
        targetStatus,
        actor: "system:professional-withdrawal",
        reason: "Profissional desistiu e não há outra disponível",
      });
      if (!moved.ok) throw moved.error;
    }
  }
  return "Tudo bem, avisamos o contratante e o pedido voltou para as outras profissionais. Avisaremos quando surgir uma nova proposta.";
}

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
    if (WITHDRAW_COMMANDS.includes(normalizeAnswer(input.text))) {
      text = await withdrawFromAcceptedService(tx, lead);
    } else if (command === "STOP") {
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
