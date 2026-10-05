import {
  Prisma,
  type CustomerBookingConversation,
  type PrismaClient,
  type PropertyPricingTier,
} from "@prisma/client";
import {
  parseCustomerChoice,
  type CustomerConversationState,
} from "../../domain/customer/customer-conversation-definition";
import {
  parseScheduleDateTime,
  customerScheduleDateChoices,
  parseScheduleDateChoice,
  parseScheduleTimeChoice,
  scheduledAtFromFortalezaLocal,
} from "../../domain/customer/customer-schedule";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { enqueueCustomerQuestion } from "./customer-question-outbox";
import { customerBookingSummary } from "../../domain/customer/customer-booking-summary";
import { env } from "../../env";

function buildPaymentInstructionsText(tier: PropertyPricingTier | null): string {
  const lines = ["✅ Pedido confirmado! Para finalizar, realize o pagamento via PIX:"];
  if (env.PIX_KEY) lines.push(`\n🔑 Chave PIX: ${env.PIX_KEY}`);
  if (tier) lines.push(`💰 Valor: R$ ${(tier.priceCents / 100).toFixed(2).replace(".", ",")}`);
  lines.push("\nAssim que confirmarmos o recebimento, seu agendamento estará garantido. Você tem até 24 horas para realizar o pagamento.");
  return lines.join("\n");
}

function buildPaymentFollowUpText(tier: PropertyPricingTier | null): string {
  const lines = ["Seu pedido ainda aguarda pagamento. Realize o PIX para confirmar o agendamento:"];
  if (env.PIX_KEY) lines.push(`\n🔑 Chave PIX: ${env.PIX_KEY}`);
  if (tier) lines.push(`💰 Valor: R$ ${(tier.priceCents / 100).toFixed(2).replace(".", ",")}`);
  lines.push("\nApós o pagamento, confirmamos em breve.");
  return lines.join("\n");
}

function pricingTierText(tiers: readonly PropertyPricingTier[]): string {
  return [
    "Qual opção descreve melhor o seu imóvel?",
    "",
    ...tiers.map((tier, index) => `${index + 1} — ${tier.label}`),
  ].join("\n");
}

function quoteText(booking: {
  totalCents: number;
  durationMinutes: number | null;
}): string {
  return [
    "Este é o valor para a limpeza completa:",
    "",
    `Valor: R$ ${(booking.totalCents / 100).toFixed(2).replace(".", ",")}`,
    `Duração prevista: ${booking.durationMinutes ?? 180} minutos`,
  ].join("\n");
}

function scheduleDateText(): string {
  return [
    "Para qual dia e horário você precisa?",
    "Ex.: amanhã às 14h.",
    "",
    "Horários disponíveis: 8h, 9h, 13h ou 14h.",
    "",
    "Se preferir, escolha primeiro o dia:",
    ...customerScheduleDateChoices().map(
      (choice, index) => `${index + 1} — ${choice.label}`
    ),
  ].join("\n");
}

function asInputJson(
  value: Prisma.JsonValue
): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

async function enqueueQuestion(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState,
  text?: string
): Promise<void> {
  await enqueueCustomerQuestion(tx, {
    conversationId: conversation.id,
    provider: conversation.provider,
    recipient,
    state,
    ...(text !== undefined ? { text } : {}),
    idempotencyKey: `customer-booking:${conversation.id}:${state}:${conversation.updatedAt.getTime()}`,
  });
}

async function enqueueManualReviewNotice(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string
): Promise<void> {
  await enqueueOutboundMessage(tx, {
    provider: conversation.provider,
    recipient,
    payload: textPayload(
      "Recebemos seus dados. Vamos validar o endereço e continuaremos por aqui."
    ),
    idempotencyKey: `customer-booking:${conversation.id}:manual-review:${conversation.updatedAt.getTime()}`,
    correlationId: conversation.id,
    actor: "system:customer-conversation",
  });
}

async function activePricingTiers(
  tx: Prisma.TransactionClient
): Promise<PropertyPricingTier[]> {
  return tx.propertyPricingTier.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });
}

const MAX_MISUNDERSTANDINGS = 2;

/**
 * Mirrors the escalation already proven for recruitment conversations: after
 * repeated invalid answers to the SAME question, hand off to a human instead
 * of looping forever. The counter is keyed to `questionState` (not reset on
 * every successful transition) so a stale count from an earlier question
 * never triggers a false escalation.
 */
async function recordInvalidAnswer(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  questionState: CustomerConversationState,
  resend: (updated: CustomerBookingConversation) => Promise<void>,
  extraData?: Prisma.CustomerBookingConversationUpdateInput
): Promise<{
  advanced: false;
  reason: "INVALID_ANSWER" | "ESCALATED_TO_HUMAN";
}> {
  const count =
    conversation.misunderstandingState === questionState
      ? conversation.misunderstandingCount + 1
      : 1;
  if (count >= MAX_MISUNDERSTANDINGS) {
    const updated = await tx.customerBookingConversation.update({
      where: { id: conversation.id },
      data: {
        ...extraData,
        state: "PAUSED",
        automationPausedAt: new Date(),
        misunderstandingCount: count,
        misunderstandingState: questionState,
        lastInboundAt: new Date(),
        version: { increment: 1 },
      },
    });
    await enqueueOutboundMessage(tx, {
      provider: updated.provider,
      recipient,
      payload: textPayload(
        "Não consegui entender sua resposta. Uma pessoa da AllSet vai continuar seu atendimento por aqui."
      ),
      idempotencyKey: `customer-booking:${updated.id}:escalated:${updated.updatedAt.getTime()}`,
      correlationId: updated.id,
      actor: "system:customer-conversation",
    });
    return { advanced: false, reason: "ESCALATED_TO_HUMAN" };
  }
  const updated = await tx.customerBookingConversation.update({
    where: { id: conversation.id },
    data: {
      ...extraData,
      misunderstandingCount: count,
      misunderstandingState: questionState,
      lastInboundAt: new Date(),
    },
  });
  await resend(updated);
  return { advanced: false, reason: "INVALID_ANSWER" };
}

async function resendCurrentQuestion(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState
): Promise<void> {
  if (state === "PROPERTY_CHARACTERISTICS") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      pricingTierText(await activePricingTiers(tx))
    );
    return;
  }
  if (state === "SCHEDULE_DATE") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      scheduleDateText()
    );
    return;
  }
  if (state === "QUOTE_ACCEPTANCE" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({
      where: { id: conversation.bookingId },
      include: { propertyPricingTier: true },
    });
    if (booking?.propertyPricingTier) {
      await enqueueQuestion(
        tx,
        conversation,
        recipient,
        state,
        `${quoteText(booking)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`
      );
      return;
    }
  }
  if (state === "ADDRESS") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      "Envie o endereço completo do atendimento para validarmos a área atendida."
    );
    return;
  }
  if (state === "FINAL_CONFIRMATION" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({
      where: { id: conversation.bookingId },
      include: { propertyPricingTier: true },
    });
    if (booking) {
      await enqueueQuestion(
        tx,
        conversation,
        recipient,
        state,
        customerBookingSummary(booking)
      );
      return;
    }
  }
  if (state === "AWAITING_PAYMENT" || state === "MANUAL_REVIEW") {
    await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient,
      payload: textPayload(
        state === "AWAITING_PAYMENT"
          ? "Seu pedido continua aguardando pagamento. Enviaremos as instruções por aqui."
          : "Seu pedido está sendo revisado. Vamos continuar por aqui assim que possível."
      ),
      idempotencyKey: `customer-booking:${conversation.id}:${state}:resumed:${conversation.updatedAt.getTime()}`,
      correlationId: conversation.id,
      actor: "system:customer-conversation",
    });
    return;
  }
  await enqueueQuestion(tx, conversation, recipient, state);
}

export async function resumeCustomerBookingConversation(
  prisma: PrismaClient,
  input: { bookingId: string; actor: string }
) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: {
        customerConversation: true,
        customer: { select: { phoneE164: true } },
      },
    });
    const paused = booking?.customerConversation;
    const state = paused?.lastQuestionKey as CustomerConversationState | null;
    if (
      !booking ||
      !paused ||
      paused.state !== "PAUSED" ||
      !state ||
      ["PAUSED", "COMPLETED", "QUOTE"].includes(state)
    ) {
      return {
        ok: false as const,
        reason: "CONVERSATION_NOT_RESUMABLE" as const,
      };
    }
    const resumeClaimed = await tx.customerBookingConversation.updateMany({
      where: { id: paused.id, version: paused.version },
      data: {
        state,
        automationPausedAt: null,
        misunderstandingCount: 0,
        misunderstandingState: null,
        lastInboundAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (!resumeClaimed.count)
      return {
        ok: false as const,
        reason: "CONVERSATION_NOT_RESUMABLE" as const,
      };
    const conversation = await tx.customerBookingConversation.findUniqueOrThrow(
      { where: { id: paused.id } }
    );
    await recordAuditLog(tx, {
      actor: input.actor,
      action: "CUSTOMER_CONVERSATION_RESUMED",
      entityType: "CustomerBookingConversation",
      entityId: conversation.id,
      metadata: { bookingId: booking.id, state },
    });
    await resendCurrentQuestion(
      tx,
      conversation,
      booking.customer.phoneE164,
      state
    );
    return { ok: true as const, conversationId: conversation.id };
  });
}

export async function startCustomerBookingConversation(
  prisma: PrismaClient,
  input: { phoneE164: string; provider: string; inboundMessageId?: string }
) {
  return prisma.$transaction(async (tx) => {
    if (input.inboundMessageId) {
      await tx.inboundMessage.updateMany({
        where: { id: input.inboundMessageId, processedAt: null },
        data: { processedAt: new Date() },
      });
    }
    const customer = await tx.user.upsert({
      where: { phoneE164: input.phoneE164 },
      create: {
        role: "CUSTOMER",
        // O telefone identifica o cliente no fluxo curto; o nome pode ser
        // confirmado pela equipe quando realmente for necessário.
        fullName: input.phoneE164,
        phoneE164: input.phoneE164,
      },
      // Keep this upsert native: nested profile writes make Prisma emulate it
      // with a read/create pair that races on the unique phone constraint.
      update: { phoneE164: input.phoneE164 },
    });
    if (customer.role !== "CUSTOMER") {
      await enqueueOutboundMessage(tx, {
        provider: input.provider,
        recipient: input.phoneE164,
        payload: textPayload(
          "Este número está cadastrado como profissional AllSet. Responda *2* para acessar o menu de profissional."
        ),
        idempotencyKey: `phone-already-used:${input.inboundMessageId ?? input.phoneE164}`,
        correlationId: input.inboundMessageId ?? input.phoneE164,
        actor: "system:customer-conversation",
      });
      return { started: false as const, reason: "PHONE_ALREADY_USED" as const };
    }
    // Serialize starts and answers for the same customer, even for distinct inbound IDs.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${customer.id} FOR UPDATE`;
    await tx.customerProfile.upsert({
      where: { userId: customer.id },
      create: { userId: customer.id },
      update: {},
    });

    const active = await tx.customerBookingConversation.findFirst({
      where: {
        customerId: customer.id,
        state: { notIn: ["COMPLETED", "PAUSED"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    // A customer who still has no real name was never asked for one. Returning
    // customers (name already collected) skip straight to pricing as before.
    const needsName = !active && customer.fullName === input.phoneE164;
    const tiers = active || needsName ? [] : await activePricingTiers(tx);
    const initialState: CustomerConversationState = needsName
      ? "NAME"
      : tiers.length
        ? "PROPERTY_CHARACTERISTICS"
        : "MANUAL_REVIEW";
    const conversation =
      active ??
      (await tx.customerBookingConversation.create({
        data: {
          customerId: customer.id,
          provider: input.provider,
          state: initialState,
          lastQuestionKey: initialState,
          lastInboundAt: new Date(),
        },
      }));

    if (!active && needsName)
      await enqueueQuestion(tx, conversation, customer.phoneE164, "NAME");
    if (!active && !needsName && tiers.length)
      await enqueueQuestion(
        tx,
        conversation,
        customer.phoneE164,
        "PROPERTY_CHARACTERISTICS",
        pricingTierText(tiers)
      );
    if (!active && !needsName && !tiers.length)
      await enqueueManualReviewNotice(tx, conversation, customer.phoneE164);
    return { started: true as const, conversation };
  });
}

export async function processCustomerBookingAnswer(
  prisma: PrismaClient,
  input: { inboundMessageId: string; text: string }
) {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundMessage.findUnique({
      where: { id: input.inboundMessageId },
    });
    if (!inbound)
      return { advanced: false, reason: "INBOUND_NOT_FOUND" as const };
    const customer = await tx.user.findUnique({
      where: { phoneE164: inbound.sender },
    });
    if (!customer || customer.role !== "CUSTOMER")
      return { advanced: false, reason: "CUSTOMER_NOT_FOUND" as const };
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${customer.id} FOR UPDATE`;
    const normalizedText = input.text
      .trim()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toUpperCase();

    const conversation = await tx.customerBookingConversation.findFirst({
      where: {
        customerId: customer.id,
        state: { notIn: ["COMPLETED", "PAUSED"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!conversation) {
      const latest = await tx.customerBookingConversation.findFirst({
        where: { customerId: customer.id },
        orderBy: { updatedAt: "desc" },
      });
      const state = latest?.lastQuestionKey as CustomerConversationState | null;
      if (
        latest?.state === "PAUSED" &&
        normalizedText === "MENU" &&
        state &&
        !["PAUSED", "COMPLETED", "QUOTE"].includes(state)
      ) {
        const claimed = await tx.inboundMessage.updateMany({
          where: { id: inbound.id, processedAt: null },
          data: { processedAt: new Date() },
        });
        if (!claimed.count)
          return { advanced: false, reason: "DUPLICATE_INBOUND" as const };
        const resumed = await tx.customerBookingConversation.update({
          where: { id: latest.id },
          data: {
            state,
            automationPausedAt: null,
            misunderstandingCount: 0,
            misunderstandingState: null,
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await resendCurrentQuestion(tx, resumed, customer.phoneE164, state);
        return { advanced: false, reason: "QUESTION_REPEATED" as const };
      }
      if (latest?.state === "PAUSED") {
        const claimed = await tx.inboundMessage.updateMany({
          where: { id: inbound.id, processedAt: null },
          data: { processedAt: new Date() },
        });
        if (claimed.count) {
          await enqueueOutboundMessage(tx, {
            provider: inbound.provider,
            recipient: customer.phoneE164,
            payload: textPayload(
              "Seu atendimento está com nossa equipe. Em breve entraremos em contato."
            ),
            idempotencyKey: `customer-booking:${latest.id}:paused-ack:${inbound.id}`,
            correlationId: latest.id,
            actor: "system:customer-conversation",
          });
        }
        return { advanced: false, reason: "CONVERSATION_PAUSED" as const };
      }
      return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
    }

    const claimed = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count)
      return { advanced: false, reason: "DUPLICATE_INBOUND" as const };

    const current = conversation.state as CustomerConversationState;
    if (
      ["MENU", "PERGUNTA", "REPETIR"].includes(normalizedText) &&
      current !== "MANUAL_REVIEW" &&
      current !== "AWAITING_PAYMENT"
    ) {
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
      });
      await resendCurrentQuestion(tx, updated, customer.phoneE164, current);
      return { advanced: false, reason: "QUESTION_REPEATED" as const };
    }
    if (
      [
        "AJUDA",
        "HELP",
        "FALAR COM ALGUEM",
        "FALAR COM ALGUÉM",
        "LIGACAO",
        "LIGAÇÃO",
        "LIGAR",
      ].includes(normalizedText)
    ) {
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "PAUSED",
          automationPausedAt: new Date(),
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload(
          "Certo. Uma pessoa da AllSet continuará seu atendimento por aqui. Se puder, conte em uma mensagem como podemos ajudar."
        ),
        idempotencyKey: `customer-booking:${updated.id}:human-help:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "HUMAN_HELP_REQUESTED" as const };
    }
    if (["PARAR", "STOP"].includes(normalizedText)) {
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "PAUSED",
          automationPausedAt: new Date(),
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload(
          "Tudo bem, pausamos este atendimento automático. Quando quiser continuar, responda MENU."
        ),
        idempotencyKey: `customer-booking:${updated.id}:stopped:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "STOPPED" as const };
    }

    if (current === "MANUAL_REVIEW") {
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload(
          "Seu pedido está sendo revisado. Vamos continuar por aqui assim que possível."
        ),
        idempotencyKey: `customer-booking:${updated.id}:manual-review-follow-up:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "MANUAL_REVIEW" as const };
    }
    if (current === "AWAITING_PAYMENT") {
      const bookingWithTier = conversation.bookingId
        ? await tx.booking.findUnique({
            where: { id: conversation.bookingId },
            include: { propertyPricingTier: true },
          })
        : null;
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload(
          buildPaymentFollowUpText(bookingWithTier?.propertyPricingTier ?? null)
        ),
        idempotencyKey: `customer-booking:${updated.id}:awaiting-payment-follow-up:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "AWAITING_PAYMENT" as const };
    }

    if (current === "INTRODUCTION") {
      const answer = parseCustomerChoice(current, input.text);
      if (answer === "NO") {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: { state: "COMPLETED", lastInboundAt: new Date() },
        });
        await enqueueOutboundMessage(tx, {
          provider: updated.provider,
          recipient: customer.phoneE164,
          payload: textPayload(
            "Tudo bem! Quando precisar de uma limpeza, é só mandar MENU por aqui."
          ),
          idempotencyKey: `customer-booking:${updated.id}:declined:${updated.updatedAt.getTime()}`,
          correlationId: updated.id,
          actor: "system:customer-conversation",
        });
        return { advanced: false, reason: "DECLINED" as const };
      }
      if (answer !== "YES") {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: { lastInboundAt: new Date() },
        });
        await enqueueQuestion(tx, updated, customer.phoneE164, "INTRODUCTION");
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "NAME",
          lastQuestionKey: "NAME",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueQuestion(tx, updated, customer.phoneE164, "NAME");
      return { advanced: true, state: "NAME" as const };
    }

    if (current === "NAME") {
      const name = input.text.trim();
      if (name.length < 2 || name.length > 120) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "NAME",
          (updated) => enqueueQuestion(tx, updated, customer.phoneE164, "NAME")
        );
      }
      await tx.user.update({
        where: { id: customer.id },
        data: { fullName: name },
      });
      const tiers = await activePricingTiers(tx);
      const nextState: CustomerConversationState = tiers.length
        ? "PROPERTY_CHARACTERISTICS"
        : "MANUAL_REVIEW";
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: nextState,
          lastQuestionKey: nextState,
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (!tiers.length) {
        await enqueueManualReviewNotice(tx, updated, customer.phoneE164);
        return { advanced: false, reason: "PRICING_NOT_CONFIGURED" as const };
      }
      await enqueueQuestion(
        tx,
        updated,
        customer.phoneE164,
        nextState,
        pricingTierText(tiers)
      );
      return { advanced: true, state: nextState };
    }

    if (current === "PROPERTY_CHARACTERISTICS") {
      const tiers = await activePricingTiers(tx);
      const numericChoice = Number(input.text.trim());
      const normalizedTier = input.text
        .trim()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toUpperCase()
        .replace(/\bUM\b/g, "1")
        .replace(/\bDOIS\b/g, "2")
        .replace(/\bTRES\b/g, "3")
        .replace(/\bQUATRO\b/g, "4");
      const matchingTiers = tiers.filter((item) => {
        const label = item.label
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toUpperCase()
          .replace(/\bUM\b/g, "1")
          .replace(/\bDOIS\b/g, "2")
          .replace(/\bTRES\b/g, "3")
          .replace(/\bQUATRO\b/g, "4");
        return (
          label === normalizedTier ||
          label.includes(normalizedTier) ||
          normalizedTier.includes(label)
        );
      });
      const tier = Number.isInteger(numericChoice)
        ? tiers[numericChoice - 1]
        : matchingTiers.length === 1
          ? matchingTiers[0]
          : undefined;
      if (!tier) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "PROPERTY_CHARACTERISTICS",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              current,
              pricingTierText(tiers)
            )
        );
      }
      const service = await tx.serviceDefinition.findFirst({
        where: { isActive: true },
        orderBy: { code: "asc" },
      });
      if (!service) {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "MANUAL_REVIEW",
            lastQuestionKey: "MANUAL_REVIEW",
            lastInboundAt: new Date(),
          },
        });
        await enqueueManualReviewNotice(tx, updated, customer.phoneE164);
        return { advanced: false, reason: "SERVICE_NOT_CONFIGURED" as const };
      }
      const booking = conversation.bookingId
        ? await tx.booking.update({
            where: { id: conversation.bookingId },
            data: {
              propertyPricingTierId: tier.id,
              propertyCharacteristics: asInputJson(tier.characteristics),
              durationMinutes: tier.durationMinutes,
              totalCents: tier.priceCents,
              requestedAt: new Date(),
              scheduledAt: null,
              addressLine1: null,
              addressLine2: null,
              addressReference: null,
              coverageValidatedAt: null,
              outsideCoverageArea: false,
              neighborhood: null,
              professionalPaymentCents: null,
            },
          })
        : await tx.booking.create({
            data: {
              customerId: customer.id,
              serviceId: service.id,
              propertyPricingTierId: tier.id,
              propertyCharacteristics: asInputJson(tier.characteristics),
              durationMinutes: tier.durationMinutes,
              totalCents: tier.priceCents,
              requestedAt: new Date(),
            },
          });
      if (!conversation.bookingId) {
        const collecting = await transitionBookingStatusInTransaction(tx, {
          bookingId: booking.id,
          targetStatus: "COLLECTING_DATA",
          actor: "system:customer-conversation",
        });
        if (!collecting.ok) throw collecting.error;
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          bookingId: booking.id,
          pendingScheduleDate: null,
          state: "SCHEDULE_DATE",
          lastQuestionKey: "SCHEDULE_DATE",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueQuestion(
        tx,
        updated,
        customer.phoneE164,
        "SCHEDULE_DATE",
        scheduleDateText()
      );
      return {
        advanced: true,
        state: "SCHEDULE_DATE" as const,
        bookingId: booking.id,
      };
    }

    if (current === "SCHEDULE_DATE") {
      const naturalSlot = parseScheduleDateTime(input.text);
      if (naturalSlot && conversation.bookingId) {
        const scheduledAt = scheduledAtFromFortalezaLocal(
          naturalSlot.date,
          naturalSlot.time
        );
        const booking = await tx.booking.findUnique({
          where: { id: conversation.bookingId },
          include: { propertyPricingTier: true },
        });
        if (
          scheduledAt &&
          scheduledAt > new Date() &&
          booking?.propertyPricingTier
        ) {
          await tx.booking.update({
            where: { id: booking.id },
            data: { scheduledAt },
          });
          const quoted = await transitionBookingStatusInTransaction(tx, {
            bookingId: booking.id,
            targetStatus: "QUOTED",
            actor: "system:customer-conversation",
          });
          if (!quoted.ok) throw quoted.error;
          await tx.booking.update({
            where: { id: booking.id },
            data: { quotedAt: new Date() },
          });
          if (
            booking.addressLine1 &&
            booking.coverageValidatedAt &&
            !booking.outsideCoverageArea
          ) {
            const awaitingConfirmation =
              await transitionBookingStatusInTransaction(tx, {
                bookingId: booking.id,
                targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
                actor: "system:customer-conversation",
                reason: "Horário alterado; endereço já validado",
              });
            if (!awaitingConfirmation.ok) throw awaitingConfirmation.error;
            const updated = await tx.customerBookingConversation.update({
              where: { id: conversation.id },
              data: {
                pendingScheduleDate: null,
                state: "FINAL_CONFIRMATION",
                lastQuestionKey: "FINAL_CONFIRMATION",
                lastInboundAt: new Date(),
                version: { increment: 1 },
              },
            });
            await resendCurrentQuestion(
              tx,
              updated,
              customer.phoneE164,
              "FINAL_CONFIRMATION"
            );
            return {
              advanced: true,
              state: "FINAL_CONFIRMATION" as const,
              bookingId: booking.id,
            };
          }
          const updated = await tx.customerBookingConversation.update({
            where: { id: conversation.id },
            data: {
              pendingScheduleDate: null,
              state: "ADDRESS",
              lastQuestionKey: "ADDRESS",
              lastInboundAt: new Date(),
              version: { increment: 1 },
            },
          });
          await enqueueQuestion(
            tx,
            updated,
            customer.phoneE164,
            "ADDRESS",
            `${quoteText(booking)}\n\nAgora envie o endereço completo para validarmos a área atendida.`
          );
          return {
            advanced: true,
            state: "ADDRESS" as const,
            bookingId: booking.id,
          };
        }
      }
      const scheduleDate = parseScheduleDateChoice(input.text);
      if (!scheduleDate || !conversation.bookingId) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_DATE",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "SCHEDULE_DATE",
              scheduleDateText()
            )
        );
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          pendingScheduleDate: scheduleDate,
          state: "SCHEDULE_TIME",
          lastQuestionKey: "SCHEDULE_TIME",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_TIME");
      return { advanced: true, state: "SCHEDULE_TIME" as const };
    }

    if (current === "SCHEDULE_TIME") {
      const scheduleTime = parseScheduleTimeChoice(input.text);
      if (
        !scheduleTime ||
        !conversation.pendingScheduleDate ||
        !conversation.bookingId
      ) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_TIME",
          (updated) =>
            enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_TIME")
        );
      }
      const scheduledAt = scheduledAtFromFortalezaLocal(
        conversation.pendingScheduleDate,
        scheduleTime
      );
      if (!scheduledAt || scheduledAt <= new Date()) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_DATE",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "SCHEDULE_DATE",
              scheduleDateText()
            ),
          {
            pendingScheduleDate: null,
            state: "SCHEDULE_DATE",
            lastQuestionKey: "SCHEDULE_DATE",
          }
        );
      }
      const booking = await tx.booking.findUnique({
        where: { id: conversation.bookingId },
        include: { propertyPricingTier: true },
      });
      if (!booking?.propertyPricingTier) {
        if (booking) {
          const review = await transitionBookingStatusInTransaction(tx, {
            bookingId: booking.id,
            targetStatus: "REVIEW_REQUIRED",
            actor: "system:customer-conversation",
            reason: "Configuração de preço removida durante o agendamento",
          });
          if (!review.ok) throw review.error;
        }
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "MANUAL_REVIEW",
            lastQuestionKey: "MANUAL_REVIEW",
            lastInboundAt: new Date(),
          },
        });
        await enqueueOutboundMessage(tx, {
          provider: updated.provider,
          recipient: customer.phoneE164,
          payload: textPayload(
            "Houve uma atualização nos serviços disponíveis. Nossa equipe entrará em contato para concluir seu agendamento."
          ),
          idempotencyKey: `customer-booking:${updated.id}:booking-misconfigured:${updated.updatedAt.getTime()}`,
          correlationId: updated.id,
          actor: "system:customer-conversation",
        });
        return { advanced: false, reason: "BOOKING_NOT_CONFIGURED" as const };
      }
      await tx.booking.update({
        where: { id: booking.id },
        data: { scheduledAt },
      });
      const quoted = await transitionBookingStatusInTransaction(tx, {
        bookingId: booking.id,
        targetStatus: "QUOTED",
        actor: "system:customer-conversation",
      });
      if (!quoted.ok) throw quoted.error;
      await tx.booking.update({
        where: { id: booking.id },
        data: { quotedAt: new Date() },
      });
      if (
        booking.addressLine1 &&
        booking.coverageValidatedAt &&
        !booking.outsideCoverageArea
      ) {
        const awaitingConfirmation = await transitionBookingStatusInTransaction(
          tx,
          {
            bookingId: booking.id,
            targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
            actor: "system:customer-conversation",
            reason: "Horário alterado; endereço já validado",
          }
        );
        if (!awaitingConfirmation.ok) throw awaitingConfirmation.error;
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            pendingScheduleDate: null,
            state: "FINAL_CONFIRMATION",
            lastQuestionKey: "FINAL_CONFIRMATION",
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await resendCurrentQuestion(
          tx,
          updated,
          customer.phoneE164,
          "FINAL_CONFIRMATION"
        );
        return {
          advanced: true,
          state: "FINAL_CONFIRMATION" as const,
          bookingId: booking.id,
        };
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          pendingScheduleDate: null,
          state: "QUOTE_ACCEPTANCE",
          lastQuestionKey: "QUOTE_ACCEPTANCE",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueQuestion(
        tx,
        updated,
        customer.phoneE164,
        "QUOTE_ACCEPTANCE",
        `${quoteText(booking)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`
      );
      return {
        advanced: true,
        state: "QUOTE_ACCEPTANCE" as const,
        bookingId: booking.id,
      };
    }

    if (current === "QUOTE_ACCEPTANCE") {
      const answer = parseCustomerChoice(current, input.text);
      if (answer === "CHANGE") {
        if (!conversation.bookingId)
          return { advanced: false, reason: "INVALID_ANSWER" as const };
        const collecting = await transitionBookingStatusInTransaction(tx, {
          bookingId: conversation.bookingId,
          targetStatus: "COLLECTING_DATA",
          actor: "customer:whatsapp",
          reason: "Cliente solicitou alteração no orçamento",
        });
        if (!collecting.ok) throw collecting.error;
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "PROPERTY_CHARACTERISTICS",
            lastQuestionKey: "PROPERTY_CHARACTERISTICS",
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await enqueueQuestion(
          tx,
          updated,
          customer.phoneE164,
          "PROPERTY_CHARACTERISTICS",
          pricingTierText(await activePricingTiers(tx))
        );
        return { advanced: true, state: "PROPERTY_CHARACTERISTICS" as const };
      }
      if (answer !== "ACCEPT" || !conversation.bookingId) {
        const booking = conversation.bookingId
          ? await tx.booking.findUnique({
              where: { id: conversation.bookingId },
              include: { propertyPricingTier: true },
            })
          : null;
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "QUOTE_ACCEPTANCE",
          (updated) => {
            const text = booking?.propertyPricingTier
              ? `${quoteText(booking)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`
              : undefined;
            return enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "QUOTE_ACCEPTANCE",
              text
            );
          }
        );
      }
      const accepted = await transitionBookingStatusInTransaction(tx, {
        bookingId: conversation.bookingId,
        targetStatus: "QUOTE_ACCEPTED",
        actor: "customer:whatsapp",
      });
      if (!accepted.ok) throw accepted.error;
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "ADDRESS",
          lastQuestionKey: "ADDRESS",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueCustomerQuestion(tx, {
        conversationId: updated.id,
        provider: updated.provider,
        recipient: customer.phoneE164,
        state: "ADDRESS",
        text: "Agora envie o endereço completo do atendimento. Ele será usado apenas para validar a área atendida.",
        idempotencyKey: `customer-booking:${updated.id}:ADDRESS:${updated.updatedAt.getTime()}`,
      });
      return { advanced: true, state: "ADDRESS" as const };
    }

    if (current === "ADDRESS") {
      const address = input.text.trim();
      if (
        address.length < 8 ||
        address.length > 500 ||
        !conversation.bookingId
      ) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "ADDRESS",
          (updated) =>
            enqueueCustomerQuestion(tx, {
              conversationId: updated.id,
              provider: updated.provider,
              recipient: customer.phoneE164,
              state: "ADDRESS",
              text: "Envie o endereço completo do atendimento para validarmos a área atendida.",
              idempotencyKey: `customer-booking:${updated.id}:ADDRESS:retry:${updated.updatedAt.getTime()}`,
            })
        );
      }
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data: {
          addressLine1: address,
          coverageValidatedAt: null,
          outsideCoverageArea: false,
          neighborhood: null,
          professionalPaymentCents: null,
        },
      });
      const review = await transitionBookingStatusInTransaction(tx, {
        bookingId: conversation.bookingId,
        targetStatus: "REVIEW_REQUIRED",
        actor: "system:customer-conversation",
        reason: "Endereço aguarda validação de cobertura",
      });
      if (!review.ok) throw review.error;
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "MANUAL_REVIEW",
          lastQuestionKey: "MANUAL_REVIEW",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueManualReviewNotice(tx, updated, customer.phoneE164);
      return { advanced: true, state: "MANUAL_REVIEW" as const };
    }

    if (current === "FINAL_CONFIRMATION") {
      const answer = parseCustomerChoice(current, input.text);
      if (!conversation.bookingId)
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      if (answer === "CHANGE") {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "EDIT_SELECTION",
            lastQuestionKey: "EDIT_SELECTION",
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await enqueueQuestion(
          tx,
          updated,
          customer.phoneE164,
          "EDIT_SELECTION"
        );
        return { advanced: true, state: "EDIT_SELECTION" as const };
      }
      if (answer !== "PAY") {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "FINAL_CONFIRMATION",
          (updated) =>
            resendCurrentQuestion(
              tx,
              updated,
              customer.phoneE164,
              "FINAL_CONFIRMATION"
            )
        );
      }
      const awaitingPayment = await transitionBookingStatusInTransaction(tx, {
        bookingId: conversation.bookingId,
        targetStatus: "AWAITING_PAYMENT",
        actor: "customer:whatsapp",
      });
      if (!awaitingPayment.ok) throw awaitingPayment.error;
      const bookingWithTier = await tx.booking.findUnique({
        where: { id: conversation.bookingId },
        include: { propertyPricingTier: true },
      });
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "AWAITING_PAYMENT",
          lastQuestionKey: "AWAITING_PAYMENT",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      const paymentText = buildPaymentInstructionsText(
        bookingWithTier?.propertyPricingTier ?? null
      );
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload(paymentText),
        idempotencyKey: `customer-booking:${updated.id}:AWAITING_PAYMENT:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: true, state: "AWAITING_PAYMENT" as const };
    }

    if (current === "EDIT_SELECTION") {
      const choice = parseCustomerChoice(current, input.text);
      if (!conversation.bookingId || !choice) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "EDIT_SELECTION",
          (updated) =>
            enqueueQuestion(tx, updated, customer.phoneE164, "EDIT_SELECTION")
        );
      }
      const collecting = await transitionBookingStatusInTransaction(tx, {
        bookingId: conversation.bookingId,
        targetStatus: "COLLECTING_DATA",
        actor: "customer:whatsapp",
        reason: `Cliente solicitou alteração de ${choice.toLowerCase()}`,
      });
      if (!collecting.ok) throw collecting.error;
      if (choice === "PROPERTY") {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "PROPERTY_CHARACTERISTICS",
            lastQuestionKey: "PROPERTY_CHARACTERISTICS",
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await enqueueQuestion(
          tx,
          updated,
          customer.phoneE164,
          "PROPERTY_CHARACTERISTICS",
          pricingTierText(await activePricingTiers(tx))
        );
        return { advanced: true, state: "PROPERTY_CHARACTERISTICS" as const };
      }
      if (choice === "SCHEDULE") {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            state: "SCHEDULE_DATE",
            lastQuestionKey: "SCHEDULE_DATE",
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await enqueueQuestion(
          tx,
          updated,
          customer.phoneE164,
          "SCHEDULE_DATE",
          scheduleDateText()
        );
        return { advanced: true, state: "SCHEDULE_DATE" as const };
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "ADDRESS",
          lastQuestionKey: "ADDRESS",
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueQuestion(
        tx,
        updated,
        customer.phoneE164,
        "ADDRESS",
        "Envie o novo endereço completo para validarmos a área atendida."
      );
      return { advanced: true, state: "ADDRESS" as const };
    }

    return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
  });
}
