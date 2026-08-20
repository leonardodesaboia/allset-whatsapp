import type { Prisma, PrismaClient, RecruitmentConversation } from "@prisma/client";
import { QUESTIONS, globalCommand, parseAnswer, type ConversationState } from "../../domain/recruitment/conversation-definition";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { enqueueRecruitmentQuestion } from "./recruitment-question-outbox";
import { transitionLeadStatusInTransaction } from "./transition-lead-status.usecase";

function nextState(state: ConversationState, answer: string): ConversationState {
  if (state === "CHANNEL_PREFERENCE") return answer === "PHONE" ? "PAUSED" : "NAME";
  if (state === "NAME") return "NEIGHBORHOOD";
  if (state === "NEIGHBORHOOD") return "PROFESSIONAL_EXPERIENCE";
  if (state === "PROFESSIONAL_EXPERIENCE") return answer === "SIM" ? "EXPERIENCE_DURATION" : "INFORMAL_EXPERIENCE";
  if (state === "EXPERIENCE_DURATION" || state === "INFORMAL_EXPERIENCE") return "SERVICE_AREA";
  if (state === "SERVICE_AREA") return "AVAILABILITY";
  return "COMPLETED";
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

    // Bug 2 fix: nova conversa começa em INTRODUCTION. Envia apresentação da AllSet
    // antes de perguntar preferência de canal (spec §2).
    const conversation = await tx.recruitmentConversation.upsert({
      where: { leadId: lead.id },
      create: {
        leadId: lead.id,
        provider: input.provider,
        state: "INTRODUCTION",
        lastQuestionKey: "INTRODUCTION",
        lastInboundAt: new Date(),
      },
      update: { lastInboundAt: new Date() },
    });

    if (conversation.state === "INTRODUCTION") {
      await enqueueQuestion(tx, conversation, input.phoneE164, "INTRODUCTION");
      const atChannel = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "CHANNEL_PREFERENCE", lastQuestionKey: "CHANNEL_PREFERENCE" },
      });
      await enqueueQuestion(tx, atChannel, input.phoneE164, "CHANNEL_PREFERENCE");
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
  input: { leadId: string; actor: string },
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

    const state = conversation.lastQuestionKey as ConversationState | null;
    if (!state || !QUESTIONS[state]) throw new Error("Não há uma pergunta válida para retomar");

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
    if (!lead) return { advanced: false, reason: "LEAD_NOT_FOUND" as const };

    // Bug 6 fix: garante phoneE164 presente antes de qualquer enqueue.
    const phoneE164 = lead.phoneE164;
    if (!phoneE164) return { advanced: false, reason: "NO_PHONE" as const };

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
      await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date() },
      });
      return { advanced: false, reason: "PHONE_REQUESTED" as const };
    }

    if (command === "STOP") {
      const status = await transitionStatus(tx, lead.id, "PAUSADA", "Automação pausada pela profissional");
      await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date() },
      });
      await tx.recruitmentLead.update({
        where: { id: status.id },
        data: { nextAction: "Retomar pré-cadastro quando a profissional solicitar", nextActionAt: null },
      });
      return { advanced: false, reason: "STOPPED" as const };
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
        return { advanced: false, reason: "PHONE_REQUESTED" as const };
      }
      // Primeira ocorrência: repete a pergunta atual com áudio.
      const updated = await tx.recruitmentConversation.update({
        where: { id: conversation.id },
        data: { misunderstandingCount: count, lastInboundAt: new Date() },
      });
      await enqueueQuestion(tx, updated, phoneE164, conversation.state as ConversationState);
      return { advanced: false, reason: "MISUNDERSTOOD" as const };
    }

    const current = conversation.state as ConversationState;
    const parsedAnswer = parseAnswer(current, input.text);
    const answer = parsedAnswer ?? "";
    const allowed = QUESTIONS[current]?.options;

    if (allowed && (!parsedAnswer || !allowed.includes(answer))) {
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
      return { advanced: true, completed: false, state: "PAUSED" as const };
    }

    const next = nextState(current, answer);
    const data: Prisma.RecruitmentLeadUpdateInput = { lastInteractionAt: new Date() };
    if (current === "NAME") data.fullName = input.text.trim();
    if (current === "NEIGHBORHOOD") data.neighborhood = input.text.trim();
    if (current === "PROFESSIONAL_EXPERIENCE") data.hasProfessionalExperience = answer === "SIM";
    if (current === "EXPERIENCE_DURATION") data.experienceDuration = answer as "LT_1Y" | "Y1_3" | "GT_3Y" | "BY_AUDIO";
    if (current === "INFORMAL_EXPERIENCE") data.hasInformalExperience = answer === "SIM";
    if (current === "SERVICE_AREA") data.canServeInitialArea = answer as "SIM" | "TALVEZ" | "NAO";
    if (current === "AVAILABILITY") data.availabilityDays = [input.text.trim()];
    await tx.recruitmentLead.update({ where: { id: lead.id }, data });

    const updated = await tx.recruitmentConversation.update({
      where: { id: conversation.id },
      data: { state: next, lastQuestionKey: next, lastInboundAt: new Date(), misunderstandingCount: 0 },
    });

    if (next === "COMPLETED") {
      const triageLead = await transitionStatus(tx, lead.id, "TRIAGEM");

      // Bug 4 fix: triagem verifica área E experiência (spec §7).
      const canServeArea = triageLead.canServeInitialArea !== "NAO";
      const definitelyNoExperience =
        triageLead.hasProfessionalExperience === false && triageLead.hasInformalExperience === false;

      const triageTarget = !canServeArea
        ? ("BASE_FUTURA" as const)
        : definitelyNoExperience
          ? ("AGUARDANDO_COMPLEMENTACAO" as const)
          : ("CONVERSA_PENDENTE" as const);

      await transitionStatus(tx, triageLead.id, triageTarget);
      await tx.recruitmentLead.update({
        where: { id: lead.id },
        data: {
          nextAction: triageTarget === "CONVERSA_PENDENTE" ? "Iniciar entrevista" : null,
          nextActionAt: triageTarget === "CONVERSA_PENDENTE" ? new Date() : null,
        },
      });
      return { advanced: true, completed: true, triageTarget };
    }

    await enqueueQuestion(tx, updated, phoneE164, next);
    return { advanced: true, completed: false, state: next };
  });
}
