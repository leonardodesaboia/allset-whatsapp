import type { PrismaClient } from "@prisma/client";
import { processContactIntentSelection, startContactIntentConversation } from "../customer/contact-intent-conversation.usecase";
import { processCustomerBookingAnswer, startCustomerBookingConversation } from "../customer/customer-booking-conversation.usecase";
import { processRecruitmentAnswer, startRecruitmentConversation } from "../recruitment/conversation-engine.usecase";
import { enqueueOutboundMessage } from "./enqueue-outbound-message.usecase";
import { textPayload } from "../../domain/messaging/message";
import { transitionLeadStatusInTransaction } from "../recruitment/transition-lead-status.usecase";
import type { RecruitmentStatus } from "../../domain/recruitment/recruitment-status";

const ACTIVE_FUNNEL_STATUSES: ReadonlySet<RecruitmentStatus> = new Set([
  "TRIAGEM",
  "CONVERSA_PENDENTE",
  "ENTREVISTA",
  "REFERENCIA",
  "PRE_APROVADA",
  "DOCUMENTACAO",
  "ONBOARDING",
  "TESTE_OPERACIONAL",
  "EM_VALIDACAO",
  "ATIVA",
  "PREFERENCIAL",
  "LIGACAO_SOLICITADA",
  "PRECISA_DE_AJUDA",
  "AGUARDANDO_COMPLEMENTACAO",
  "PAUSADA",
  "SUSPENSA",
]);

function ackMessage(status: RecruitmentStatus): string {
  if (status === "ATIVA" || status === "PREFERENCIAL") {
    return (
      "Olá! 👋 Você já é uma profissional ativa no AllSet. " +
      "Para dúvidas sobre agendamentos ou pagamentos, nossa equipe entrará em contato. " +
      "Se precisar de ajuda urgente, responda *AJUDA*."
    );
  }
  if (status === "PAUSADA" || status === "SUSPENSA") {
    return (
      "Olá! Recebemos sua mensagem. " +
      "Sua conta está temporariamente pausada. Entre em contato com nossa equipe para mais informações."
    );
  }
  return (
    "Olá! 👋 Recebemos sua mensagem. " +
    "Seu processo de seleção está em andamento — nossa equipe entrará em contato em breve. " +
    "Se tiver urgência, responda *AJUDA* e solicitaremos uma ligação."
  );
}

/**
 * Routes canonical text (native or transcribed) after opportunity handling.
 * The Evolution adapter deliberately does not know customer/recruitment states.
 */
export async function processContactConversationText(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string; provider: string },
) {
  const lead = await prisma.recruitmentLead.findUnique({
    where: { phoneE164: input.phoneE164 },
    include: { conversation: { select: { id: true, state: true } } },
  });
  const contactIntent = await prisma.contactIntentConversation.findUnique({ where: { phoneE164: input.phoneE164 } });

  if (!contactIntent && !lead) {
    await startContactIntentConversation(prisma, {
      phoneE164: input.phoneE164,
      provider: input.provider,
      inboundMessageId: input.inboundMessageId,
    });
    return { routed: "contact-intent" as const, started: true };
  }
  if (contactIntent?.state === "CHOOSING_INTENT") {
    const selection = await processContactIntentSelection(prisma, { inboundMessageId: input.inboundMessageId, text: input.text });
    if (selection.intent === "CUSTOMER") {
      return { routed: "customer" as const, started: await startCustomerBookingConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
    }
    if (selection.intent === "PROFESSIONAL") {
      return { routed: "recruitment" as const, started: await startRecruitmentConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
    }
    return { routed: "contact-intent" as const, selection };
  }
  if (contactIntent?.state === "CUSTOMER") {
    const result = await processCustomerBookingAnswer(prisma, { inboundMessageId: input.inboundMessageId, text: input.text });
    if (result.reason === "CONVERSATION_NOT_ACTIVE") {
      return {
        routed: "customer" as const,
        started: await startCustomerBookingConversation(prisma, {
          phoneE164: input.phoneE164,
          provider: input.provider,
          inboundMessageId: input.inboundMessageId,
        }),
      };
    }
    if (result.reason === "CONVERSATION_PAUSED") {
      return { routed: "paused" as const };
    }
    return { routed: "customer" as const, result };
  }
  if (contactIntent?.state === "PAUSED") {
    await prisma.inboundMessage.updateMany({ where: { id: input.inboundMessageId, processedAt: null }, data: { processedAt: new Date() } });
    return { routed: "paused" as const };
  }

  if (!lead) {
    return {
      routed: "recruitment" as const,
      started: await startRecruitmentConversation(prisma, {
        phoneE164: input.phoneE164,
        provider: input.provider,
        inboundMessageId: input.inboundMessageId,
      }),
    };
  }
  if (!lead.conversation || lead.conversation.state === "PAUSED" || lead.conversation.state === "MANUAL_REVIEW" || lead.conversation.state === "COMPLETED") {
    if (lead.status === "LEAD" || lead.status === "PRE_CADASTRO") {
      return { routed: "recruitment" as const, started: await startRecruitmentConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider, inboundMessageId: input.inboundMessageId }) };
    }

    // Lead ativa pede ajuda explicitamente → transiciona para LIGACAO_SOLICITADA
    const normalized = input.text.trim().toUpperCase().replace(/[*_~]/g, "");
    if (
      (normalized === "AJUDA" || normalized === "AJUDA!") &&
      (lead.status === "ATIVA" || lead.status === "PREFERENCIAL" ||
       lead.status === "TRIAGEM" || lead.status === "CONVERSA_PENDENTE" ||
       lead.status === "ENTREVISTA" || lead.status === "DOCUMENTACAO" ||
       lead.status === "ONBOARDING" || lead.status === "TESTE_OPERACIONAL" ||
       lead.status === "EM_VALIDACAO" || lead.status === "PAUSADA")
    ) {
      const claimed = await prisma.$transaction(async (tx) => {
        const claimedInbound = await tx.inboundMessage.updateMany({ where: { id: input.inboundMessageId, processedAt: null }, data: { processedAt: new Date() } });
        if (!claimedInbound.count) return false;
        const transition = await transitionLeadStatusInTransaction(tx, {
          leadId: lead.id,
          targetStatus: "LIGACAO_SOLICITADA",
          actor: "system:ack",
          reason: "Solicitou ajuda via WhatsApp",
        });
        if (!transition.ok) throw transition.error;
        await enqueueOutboundMessage(tx, {
          provider: input.provider,
          recipient: input.phoneE164,
          payload: textPayload(
            "Recebemos seu pedido de ajuda! 📞 Nossa equipe entrará em contato por ligação em breve."
          ),
          idempotencyKey: `ajuda:${input.inboundMessageId}`,
          correlationId: input.inboundMessageId,
          actor: "system:ack",
        });
        return true;
      });
      if (!claimed) return { routed: "recruitment" as const, duplicate: true };
      return { routed: "recruitment" as const, ack: true, status: "LIGACAO_SOLICITADA" };
    }

    // Lead está no funil mas sem conversa ativa: envia ACK contextual e cria nota
    if (ACTIVE_FUNNEL_STATUSES.has(lead.status as RecruitmentStatus)) {
      const text = ackMessage(lead.status as RecruitmentStatus);
      const claimed = await prisma.$transaction(async (tx) => {
        const claimedInbound = await tx.inboundMessage.updateMany({ where: { id: input.inboundMessageId, processedAt: null }, data: { processedAt: new Date() } });
        if (!claimedInbound.count) return false;
        await enqueueOutboundMessage(tx, {
          provider: input.provider,
          recipient: input.phoneE164,
          payload: textPayload(text),
          idempotencyKey: `ack:${input.inboundMessageId}`,
          correlationId: input.inboundMessageId,
          actor: "system:ack",
        });
        await tx.leadNote.create({
          data: {
            leadId: lead.id,
            type: "GERAL",
            content: `Mensagem recebida sem conversa ativa (status ${lead.status}): "${input.text.slice(0, 200)}"`,
            author: "system:ack",
          },
        });
        return true;
      });
      if (!claimed) return { routed: "recruitment" as const, duplicate: true };
      return { routed: "recruitment" as const, ack: true, status: lead.status };
    }

    await prisma.inboundMessage.updateMany({
      where: { id: input.inboundMessageId, processedAt: null },
      data: { processedAt: new Date() },
    });
    return { routed: "recruitment" as const, ignored: "NO_RECRUITMENT_CONVERSATION" as const };
  }
  return { routed: "recruitment" as const, result: await processRecruitmentAnswer(prisma, { inboundMessageId: input.inboundMessageId, text: input.text }) };
}
