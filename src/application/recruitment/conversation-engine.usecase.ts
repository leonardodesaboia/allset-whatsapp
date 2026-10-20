import type { Prisma, PrismaClient, RecruitmentConversation } from "@prisma/client";
import { QUESTIONS, globalCommand, parseAnswer, type ConversationState } from "../../domain/recruitment/conversation-definition";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { enqueueRecruitmentQuestion } from "./recruitment-question-outbox";
import { transitionLeadStatusInTransaction } from "./transition-lead-status.usecase";

/**
 * Cadastro simples: nome e aceite de propostas. Conversas paradas em perguntas
 * do fluxo anterior gravam a resposta e seguem direto para o aceite.
 */
function nextState(state: ConversationState, answer: string): ConversationState {
  if (state === "CHANNEL_PREFERENCE") return answer === "PHONE" ? "PAUSED" : "NAME";
  if (state === "EDIT_SELECTION" && answer === "NAME") return "NAME";
  return "PROPOSAL_CONSENT";
}

async function enqueueQuestion(tx: Prisma.TransactionClient, conversation: RecruitmentConversation, recipient: string, state: ConversationState) {
  await enqueueRecruitmentQuestion(tx, {
    conversation,
    recipient,
    state,
    idempotencyPrefix: `recruitment:${conversation.id}:${state}:${conversation.updatedAt.getTime()}`,
    actor: "system:conversation",
  });
}

async function transitionStatus(
  tx: Prisma.TransactionClient,
  leadId: string,
  target: "PRE_CADASTRO" | "TRIAGEM" | "CONVERSA_PENDENTE" | "BASE_FUTURA" | "LIGACAO_SOLICITADA" | "PRECISA_DE_AJUDA" | "AGUARDANDO_COMPLEMENTACAO" | "PAUSADA",
  reason?: string,
) {
  const transition = await transitionLeadStatusInTransaction(tx, {
    leadId,
    targetStatus: target,
    actor: "system:conversation",
    ...(reason ? { reason } : {}),
  });
  if (!transition.ok) throw transition.error;
  return transition.value;
}

export async function startRecruitmentConversation(
  prisma: PrismaClient,
  input: { phoneE164: string; provider: string; fullName?: string; inboundMessageId?: string },
) {
  return prisma.$transaction(async (tx) => {
    if (input.inboundMessageId) {
      await tx.inboundMessage.updateMany({
        where: { id: input.inboundMessageId, processedAt: null },
        data: { processedAt: new Date() },
      });
    }
    let lead = await tx.recruitmentLead.upsert({
      where: { phoneE164: input.phoneE164 },
      create: { origin: "WHATSAPP", phoneE164: input.phoneE164, ...(input.fullName ? { fullName: input.fullName } : {}) },
      update: {},
    });
    if (lead.status === "LEAD") lead = await transitionStatus(tx, lead.id, "PRE_CADASTRO");

    // Quem iniciou pelo WhatsApp já escolheu o canal. Começamos pela primeira
    // informação útil e mantemos LIGAR/AJUDA disponíveis globalmente.
    const conversation = await tx.recruitmentConversation.upsert({
      where: { leadId: lead.id },
      create: {
        leadId: lead.id,
        provider: input.provider,
        state: "NAME",
        lastQuestionKey: "NAME",
        lastInboundAt: new Date(),
      },
      update: {
        lastInboundAt: new Date(),
        // Quem já tem nome e ainda não aceitou propostas vai direto ao aceite.
        ...(!lead.proposalsAcceptedAt && lead.fullName && !["SUSPENSA", "REPROVADA", "DESISTIU"].includes(lead.status)
          ? { state: "PROPOSAL_CONSENT", lastQuestionKey: "PROPOSAL_CONSENT", automationPausedAt: null }
          : {}),
      },
    });

    if (conversation.state === "PROPOSAL_CONSENT") {
      await enqueueQuestion(tx, conversation, input.phoneE164, "PROPOSAL_CONSENT");
    } else if (conversation.state === "NAME") {
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: input.phoneE164,
        payload: textPayload(`${QUESTIONS.INTRODUCTION!.text}\n\n${QUESTIONS.NAME!.text}`),
        idempotencyKey: `recruitment:${conversation.id}:introduction-name:${conversation.updatedAt.getTime()}`,
        correlationId: conversation.id,
        actor: "system:conversation",
      });
      // A primeira pergunta também precisa estar disponível em áudio. O texto
      // acima já a contém, então aqui enviamos apenas o áudio configurado.
      await enqueueRecruitmentQuestion(tx, {
        conversation,
        recipient: input.phoneE164,
        state: "NAME",
        idempotencyPrefix: `recruitment:${conversation.id}:introduction-name:${conversation.updatedAt.getTime()}`,
        includeText: false,
        actor: "system:conversation",
      });
    } else if (conversation.state === "INTRODUCTION") {
      // Compatibilidade para conversas iniciadas antes do fluxo curto.
      const atChannel = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "CHANNEL_PREFERENCE", lastQuestionKey: "CHANNEL_PREFERENCE" },
      });
      await enqueueOutboundMessage(tx, {
        provider: atChannel.provider,
        recipient: input.phoneE164,
        payload: textPayload(`${QUESTIONS.INTRODUCTION!.text}\n\n${QUESTIONS.CHANNEL_PREFERENCE!.text}`),
        idempotencyKey: `recruitment:${atChannel.id}:introduction-channel:${atChannel.updatedAt.getTime()}`,
        correlationId: atChannel.id,
        actor: "system:conversation",
      });
    } else if (conversation.state === "CHANNEL_PREFERENCE") {
      // Profissional retorna à primeira pergunta: reenvia sem apresentação.
      await enqueueQuestion(tx, conversation, input.phoneE164, "CHANNEL_PREFERENCE");
    }

    return { lead, conversation };
  });
}

/** Lets an administrator return a paused/manual conversation to its last real question. */
export async function resumeRecruitmentConversation(
  prisma: PrismaClient,
  input: { leadId: string; actor: string; inboundMessageId?: string },
) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.recruitmentConversation.findUnique({
      where: { leadId: input.leadId },
      include: { lead: true },
    });
    if (!conversation || !conversation.lead.phoneE164) throw new Error("Conversa de recrutamento não encontrada");
    if (conversation.state !== "PAUSED" && conversation.state !== "MANUAL_REVIEW") {
      throw new Error("A conversa não está pausada nem aguardando revisão");
    }

    const state = conversation.lastQuestionKey === "SERVICE_AREA" ? "REGIONS" : conversation.lastQuestionKey as ConversationState | null;
    if (!state || !QUESTIONS[state]) throw new Error("Não há uma pergunta válida para retomar");

    if (input.inboundMessageId) {
      const claimed = await tx.inboundMessage.updateMany({
        where: { id: input.inboundMessageId, processedAt: null },
        data: { processedAt: new Date() },
      });
      // A webhook retry must not re-send the resumed question.
      if (!claimed.count) return conversation;
    }

    if (conversation.lead.status === "PAUSADA" || conversation.lead.status === "LIGACAO_SOLICITADA" || conversation.lead.status === "PRECISA_DE_AJUDA") {
      const transition = await transitionLeadStatusInTransaction(tx, {
        leadId: conversation.leadId,
        targetStatus: "PRE_CADASTRO",
        actor: input.actor,
        reason: "Automação de pré-cadastro retomada",
      });
      if (!transition.ok) throw transition.error;
    }

    const resumed = await tx.recruitmentConversation.update({
      where: { id: conversation.id },
      data: { state, automationPausedAt: null, misunderstandingCount: 0, lastInboundAt: new Date() },
    });
    await tx.recruitmentLead.update({
      where: { id: conversation.leadId },
      data: { nextAction: null, nextActionAt: null },
    });
    await enqueueQuestion(tx, resumed, conversation.lead.phoneE164, state);
    return resumed;
  });
}

export async function processRecruitmentAnswer(
  prisma: PrismaClient,
  input: { text: string; inboundMessageId: string },
) {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
    if (!inbound) return { advanced: false, reason: "INBOUND_NOT_FOUND" as const };

    const lead = await tx.recruitmentLead.findUnique({ where: { phoneE164: inbound.sender } });
    if (!lead) {
      await tx.inboundMessage.updateMany({ where: { id: input.inboundMessageId, processedAt: null }, data: { processedAt: new Date() } });
      return { advanced: false, reason: "LEAD_NOT_FOUND" as const };
    }

    // Bug 6 fix: garante phoneE164 presente antes de qualquer enqueue.
    const phoneE164 = lead.phoneE164;
    if (!phoneE164) return { advanced: false, reason: "NO_PHONE" as const };
    await tx.$queryRaw`SELECT id FROM "RecruitmentLead" WHERE id = ${lead.id} FOR UPDATE`;

    const claimedInbound = await tx.inboundMessage.updateMany({
      where: { id: input.inboundMessageId, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimedInbound.count) return { advanced: false, reason: "DUPLICATE_INBOUND" as const };

    const conversation = await tx.recruitmentConversation.findUnique({
      where: { leadId: lead.id },
      include: { lead: true },
    });
    if (!conversation || conversation.state === "COMPLETED" || conversation.state === "PAUSED" || conversation.state === "MANUAL_REVIEW") {
      if (conversation && phoneE164) {
        const ackText =
          conversation.state === "COMPLETED"
            ? "Seu pré-cadastro na AllSet já foi concluído! Nossa equipe entrará em contato em breve."
            : "Sua mensagem foi recebida. Nossa equipe da AllSet entrará em contato assim que possível!";
        await enqueueOutboundMessage(tx, {
          provider: conversation.provider,
          recipient: phoneE164,
          payload: textPayload(ackText),
          idempotencyKey: `recruitment:${conversation.id}:inactive-ack:${input.inboundMessageId}`,
          correlationId: conversation.id,
          actor: "system:conversation",
        });
      }
      return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
    }

    const command = globalCommand(input.text);

    if (command === "PHONE" || command === "HELP") {
      await transitionStatus(tx, lead.id, "LIGACAO_SOLICITADA", "Solicitada por mensagem");
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: { nextAction: "Ligar para profissional", nextActionAt: new Date() },
      });
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date() },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: phoneE164,
        payload: textPayload("Recebemos seu pedido de ajuda. Nossa equipe vai falar com você por ligação em breve."),
        idempotencyKey: `recruitment:${updated.id}:help:${input.inboundMessageId}`,
        correlationId: updated.id,
        actor: "system:conversation",
      });
      return { advanced: false, reason: "PHONE_REQUESTED" as const };
    }

    if (command === "STOP") {
      const status = await transitionStatus(tx, lead.id, "PAUSADA", "Automação pausada pela profissional");
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date() },
      });
      await tx.recruitmentLead.update({
        where: { id: status.id },
        data: { nextAction: "Retomar pré-cadastro quando a profissional solicitar", nextActionAt: null },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: phoneE164,
        payload: textPayload("Tudo bem, pausamos seu pré-cadastro. Quando quiser continuar, responda MENU."),
        idempotencyKey: `recruitment:${updated.id}:stopped:${input.inboundMessageId}`,
        correlationId: updated.id,
        actor: "system:conversation",
      });
      return { advanced: false, reason: "STOPPED" as const };
    }

    if (command === "MENU") {
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date(), misunderstandingCount: 0, ...(conversation.state === "SERVICE_AREA" ? { state: "REGIONS", lastQuestionKey: "REGIONS" } : {}) },
      });
      await enqueueQuestion(tx, updated, phoneE164, updated.state as ConversationState);
      return { advanced: false, reason: "QUESTION_REPEATED" as const };
    }

    // Bug 3 fix: trata "Não entendi" explicitamente (spec §5).
    if (command === "MISUNDERSTOOD") {
      const count = conversation.misunderstandingCount + 1;
      if (count >= 2) {
        // Segunda ocorrência: sugere ligação.
        await transitionStatus(tx, lead.id, "LIGACAO_SOLICITADA", "Múltiplas incompreensões");
        await tx.recruitmentLead.update({
          where: { id: lead.id },
          data: { nextAction: "Ligar para profissional", nextActionAt: new Date() },
        });
        await tx.recruitmentConversation.update({
          where: { id: conversation.id },
          data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date(), misunderstandingCount: count },
        });
        await enqueueOutboundMessage(tx, {
          provider: conversation.provider,
          recipient: phoneE164,
          payload: textPayload("Recebemos seu pedido de ajuda. Pausamos as perguntas e nossa equipe entrará em contato para ajudar com o cadastro."),
          idempotencyKey: `recruitment:${conversation.id}:misunderstood-help:${input.inboundMessageId}`,
          correlationId: conversation.id,
          actor: "system:conversation",
        });
        return { advanced: false, reason: "PHONE_REQUESTED" as const };
      }
      // Primeira ocorrência: repete a pergunta atual com áudio.
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { misunderstandingCount: count, lastInboundAt: new Date() },
      });
      await enqueueQuestion(tx, updated, phoneE164, updated.state as ConversationState);
      return { advanced: false, reason: "MISUNDERSTOOD" as const };
    }

    // An old yes/no coverage question must never reject a region or save its number.
    if (conversation.state === "SERVICE_AREA") {
      const updated = await tx.recruitmentConversation.update({ where: { id: conversation.id }, data: { state: "REGIONS", lastQuestionKey: "REGIONS", lastInboundAt: new Date(), misunderstandingCount: 0 } });
      await enqueueQuestion(tx, updated, phoneE164, "REGIONS");
      return { advanced: false, reason: "QUESTION_REPEATED" as const };
    }
    const current = conversation.state as ConversationState;
    const parsedAnswer = parseAnswer(current, input.text);
    const answer = parsedAnswer ?? "";
    const allowed = QUESTIONS[current]?.options;

    if (!parsedAnswer || (allowed && !allowed.includes(answer))) {
      const misunderstandings = conversation.misunderstandingCount + 1;
      const needsManual = misunderstandings >= 2;
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: {
          state: needsManual ? "MANUAL_REVIEW" : current,
          misunderstandingCount: misunderstandings,
          lastInboundAt: new Date(),
        },
      });
      if (needsManual) {
        const status = await transitionStatus(tx, lead.id, "PRECISA_DE_AJUDA", "Respostas não estruturadas repetidas");
        await tx.recruitmentLead.update({
          where: { id: status.id },
          data: { nextAction: "Revisar resposta não estruturada", nextActionAt: new Date() },
        });
        await enqueueOutboundMessage(tx, {
          provider: updated.provider,
          recipient: phoneE164,
          payload: textPayload("Não se preocupe, não consegui entender sua resposta. Vou pedir para alguém da equipe falar com você por ligação."),
          idempotencyKey: `recruitment:${updated.id}:manual-help:${input.inboundMessageId}`,
          correlationId: updated.id,
          actor: "system:conversation",
        });
      } else {
        await enqueueQuestion(tx, updated, phoneE164, current);
      }
      return { advanced: false, reason: needsManual ? ("MANUAL_REVIEW" as const) : ("INVALID_ANSWER" as const) };
    }

    // Escolher ligação no próprio menu é uma solicitação explícita de atendimento
    // humano, não apenas uma pausa da automação. Sem este encaminhamento o lead
    // ficava em PRE_CADASTRO e deixava de aparecer na fila para ligação.
    if (current === "CHANNEL_PREFERENCE" && answer === "PHONE") {
      await transitionStatus(tx, lead.id, "LIGACAO_SOLICITADA", "Ligação escolhida no pré-cadastro");
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: { nextAction: "Ligar para profissional", nextActionAt: new Date() },
      });
      await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date(), misunderstandingCount: 0 },
      });
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: phoneE164,
        payload: textPayload("Recebemos sua preferência por ligação. Pausamos as perguntas e nossa equipe entrará em contato para continuar o cadastro."),
        idempotencyKey: `recruitment:${conversation.id}:channel-phone:${input.inboundMessageId}`,
        correlationId: conversation.id,
        actor: "system:conversation",
      });
      return { advanced: true, completed: false, state: "PAUSED" as const };
    }

    if (current === "PROPOSAL_CONSENT") {
      const accepted = answer === "SIM";
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: { proposalsAcceptedAt: accepted ? new Date() : null, nextAction: null, nextActionAt: null, lastInteractionAt: new Date() },
      });
      if (accepted && lead.status !== "ATIVA" && lead.status !== "PREFERENCIAL") {
        const transition = await transitionLeadStatusInTransaction(tx, {
          leadId: lead.id,
          targetStatus: "ATIVA",
          actor: "system:conversation",
          reason: "Cadastro simples concluído com aceite de propostas pelo WhatsApp",
        });
        if (!transition.ok) throw transition.error;
      } else if (!accepted && lead.status !== "PAUSADA") {
        await transitionStatus(tx, lead.id, "PAUSADA", "Não aceitou receber propostas");
      }
      await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "COMPLETED", lastQuestionKey: "PROPOSAL_CONSENT", editingAnswer: false, lastInboundAt: new Date(), misunderstandingCount: 0 },
      });
      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          type: accepted ? "PROPOSALS_ACCEPTED" : "PROPOSALS_DECLINED",
          description: accepted ? "Aceitou receber propostas pelo WhatsApp" : "Recusou receber propostas",
          actor: "system:conversation",
        },
      });
      await enqueueOutboundMessage(tx, {
        provider: conversation.provider,
        recipient: phoneE164,
        payload: textPayload(
          accepted
            ? "✅ Cadastro concluído! Você vai receber as propostas por aqui. Quem aceitar primeiro fica com o serviço, e o valor é combinado direto com o contratante. Para deixar de receber, envie PARAR. Para suporte, envie AJUDA."
            : "Tudo bem! Você não vai receber propostas. Se mudar de ideia, envie MENU."
        ),
        idempotencyKey: `recruitment:${conversation.id}:consent:${input.inboundMessageId}`,
        correlationId: conversation.id,
        actor: "system:conversation",
      });
      return { advanced: true, completed: true, accepted };
    }

    const next = nextState(current, answer);
    const data: Prisma.RecruitmentLeadUpdateInput = { lastInteractionAt: new Date() };
    if (current === "NAME") data.fullName = input.text.trim();
    if (current === "REGIONS") data.serviceRegions = input.text.trim();
    if (current === "EXPERIENCE_KIND") { data.hasProfessionalExperience = answer !== "NONE"; data.hasInformalExperience = answer === "DIARISTA"; }
    if (current === "NEIGHBORHOOD") data.neighborhood = input.text.trim();
    if (current === "PROFESSIONAL_EXPERIENCE") data.hasProfessionalExperience = answer === "SIM";
    if (current === "EXPERIENCE_DURATION") data.experienceDuration = answer as "LT_1Y" | "Y1_3" | "GT_3Y" | "BY_AUDIO";
    if (current === "INFORMAL_EXPERIENCE") data.hasInformalExperience = answer === "SIM";
    if (current === "SERVICE_AREA") data.canServeInitialArea = answer as "SIM" | "TALVEZ" | "NAO";
    if (current === "AVAILABILITY") data.availabilityDays = answer.split("; ");
    await tx.recruitmentLead.update({ where: { id: lead.id }, data });

    const updated = await tx.recruitmentConversation.update({
      where: { id: conversation.id },
      data: { state: next, lastQuestionKey: next, editingAnswer: false, lastInboundAt: new Date(), misunderstandingCount: 0 },
    });

    await enqueueQuestion(tx, updated, phoneE164, next);
    return { advanced: true, completed: false, state: next };
  });
}
