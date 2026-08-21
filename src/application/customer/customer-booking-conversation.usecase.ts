import { Prisma, type CustomerBookingConversation, type PrismaClient, type PropertyPricingTier } from "@prisma/client";
import { parseCustomerChoice, type CustomerConversationState } from "../../domain/customer/customer-conversation-definition";
import { customerScheduleDateChoices, parseScheduleDateChoice, parseScheduleTimeChoice, scheduledAtFromFortalezaLocal } from "../../domain/customer/customer-schedule";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { enqueueCustomerQuestion } from "./customer-question-outbox";

function pricingTierText(tiers: readonly PropertyPricingTier[]): string {
  return [
    "Qual opção descreve melhor o seu imóvel?",
    "",
    ...tiers.map((tier, index) => `${index + 1} — ${tier.label}`),
  ].join("\n");
}

function quoteText(tier: PropertyPricingTier): string {
  return [
    "Este é o valor para a limpeza completa:",
    "",
    `Valor: R$ ${(tier.priceCents / 100).toFixed(2).replace(".", ",")}`,
    `Duração prevista: ${tier.durationMinutes} minutos`,
  ].join("\n");
}

function scheduleDateText(): string {
  return ["Qual dia você prefere?", "", ...customerScheduleDateChoices().map((choice, index) => `${index + 1} — ${choice.label}`)].join("\n");
}

function asInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

async function enqueueQuestion(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState,
  text?: string,
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
  recipient: string,
): Promise<void> {
  await enqueueOutboundMessage(tx, {
    provider: conversation.provider,
    recipient,
    payload: textPayload("Recebemos seus dados. Vamos validar o endereço e continuaremos por aqui."),
    idempotencyKey: `customer-booking:${conversation.id}:manual-review:${conversation.updatedAt.getTime()}`,
    correlationId: conversation.id,
    actor: "system:customer-conversation",
  });
}

async function activePricingTiers(tx: Prisma.TransactionClient): Promise<PropertyPricingTier[]> {
  return tx.propertyPricingTier.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] });
}

async function resendCurrentQuestion(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState,
): Promise<void> {
  if (state === "PROPERTY_CHARACTERISTICS") {
    await enqueueQuestion(tx, conversation, recipient, state, pricingTierText(await activePricingTiers(tx)));
    return;
  }
  if (state === "SCHEDULE_DATE") {
    await enqueueQuestion(tx, conversation, recipient, state, scheduleDateText());
    return;
  }
  if (state === "QUOTE_ACCEPTANCE" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({ where: { id: conversation.bookingId }, include: { propertyPricingTier: true } });
    if (booking?.propertyPricingTier) {
      await enqueueQuestion(tx, conversation, recipient, state, `${quoteText(booking.propertyPricingTier)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`);
      return;
    }
  }
  if (state === "ADDRESS") {
    await enqueueQuestion(tx, conversation, recipient, state, "Envie o endereço completo do atendimento para validarmos a área atendida.");
    return;
  }
  if (state === "FINAL_CONFIRMATION" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({ where: { id: conversation.bookingId }, include: { propertyPricingTier: true } });
    if (booking) {
      const lines: string[] = ["Confira os dados do agendamento:", ""];
      if (booking.scheduledAt) {
        lines.push(new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }).format(booking.scheduledAt));
      }
      if (booking.addressLine1) lines.push(`📍 ${booking.addressLine1}`);
      if (booking.propertyPricingTier) {
        lines.push(`💰 R$ ${(booking.propertyPricingTier.priceCents / 100).toFixed(2).replace(".", ",")} — ${booking.propertyPricingTier.durationMinutes} min`);
      }
      lines.push("", "Podemos seguir para o pagamento?", "", "1 — Confirmar e pagar", "2 — Alterar informações");
      await enqueueQuestion(tx, conversation, recipient, state, lines.join("\n"));
      return;
    }
  }
  await enqueueQuestion(tx, conversation, recipient, state);
}

export async function resumeCustomerBookingConversation(
  prisma: PrismaClient,
  input: { bookingId: string; actor: string },
) {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { customerConversation: true, customer: { select: { phoneE164: true } } },
    });
    const paused = booking?.customerConversation;
    const state = paused?.lastQuestionKey as CustomerConversationState | null;
    if (!booking || !paused || paused.state !== "PAUSED" || !state || ["PAUSED", "COMPLETED", "MANUAL_REVIEW", "AWAITING_PAYMENT", "QUOTE"].includes(state)) {
      return { ok: false as const, reason: "CONVERSATION_NOT_RESUMABLE" as const };
    }
    const resumeClaimed = await tx.customerBookingConversation.updateMany({
      where: { id: paused.id, version: paused.version },
      data: { state, automationPausedAt: null, lastInboundAt: new Date(), version: { increment: 1 } },
    });
    if (!resumeClaimed.count) return { ok: false as const, reason: "CONVERSATION_NOT_RESUMABLE" as const };
    const conversation = await tx.customerBookingConversation.findUniqueOrThrow({ where: { id: paused.id } });
    await recordAuditLog(tx, {
      actor: input.actor,
      action: "CUSTOMER_CONVERSATION_RESUMED",
      entityType: "CustomerBookingConversation",
      entityId: conversation.id,
      metadata: { bookingId: booking.id, state },
    });
    await resendCurrentQuestion(tx, conversation, booking.customer.phoneE164, state);
    return { ok: true as const, conversationId: conversation.id };
  });
}

export async function startCustomerBookingConversation(
  prisma: PrismaClient,
  input: { phoneE164: string; provider: string; inboundMessageId?: string },
) {
  return prisma.$transaction(async (tx) => {
    if (input.inboundMessageId) {
      await tx.inboundMessage.updateMany({ where: { id: input.inboundMessageId, processedAt: null }, data: { processedAt: new Date() } });
    }
    const existingUser = await tx.user.findUnique({ where: { phoneE164: input.phoneE164 } });
    if (existingUser && existingUser.role !== "CUSTOMER") {
      return { started: false as const, reason: "PHONE_ALREADY_USED" as const };
    }

    const customer = existingUser ?? await tx.user.create({
      data: {
        role: "CUSTOMER",
        // O telefone é só um placeholder técnico até a etapa NAME; nunca é
        // apresentado como nome ao cliente.
        fullName: input.phoneE164,
        phoneE164: input.phoneE164,
        customerProfile: { create: {} },
      },
    });

    const active = await tx.customerBookingConversation.findFirst({
      where: { customerId: customer.id, state: { notIn: ["COMPLETED", "PAUSED"] } },
      orderBy: { updatedAt: "desc" },
    });
    const conversation = active ?? await tx.customerBookingConversation.create({
      data: {
        customerId: customer.id,
        provider: input.provider,
        state: "INTRODUCTION",
        lastQuestionKey: "INTRODUCTION",
        lastInboundAt: new Date(),
      },
    });

    if (!active) await enqueueQuestion(tx, conversation, customer.phoneE164, "INTRODUCTION");
    return { started: true as const, conversation };
  });
}

export async function processCustomerBookingAnswer(
  prisma: PrismaClient,
  input: { inboundMessageId: string; text: string },
) {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
    if (!inbound) return { advanced: false, reason: "INBOUND_NOT_FOUND" as const };
    const customer = await tx.user.findUnique({ where: { phoneE164: inbound.sender } });
    if (!customer || customer.role !== "CUSTOMER") return { advanced: false, reason: "CUSTOMER_NOT_FOUND" as const };

    const conversation = await tx.customerBookingConversation.findFirst({
      where: { customerId: customer.id, state: { notIn: ["COMPLETED", "PAUSED"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (!conversation) {
      const latest = await tx.customerBookingConversation.findFirst({
        where: { customerId: customer.id },
        orderBy: { updatedAt: "desc" },
      });
      return { advanced: false, reason: latest?.state === "PAUSED" ? ("CONVERSATION_PAUSED" as const) : ("CONVERSATION_NOT_ACTIVE" as const) };
    }

    const claimed = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count) return { advanced: false, reason: "DUPLICATE_INBOUND" as const };

    const current = conversation.state as CustomerConversationState;
    const normalizedText = input.text.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
    if (["AJUDA", "HELP", "MENU"].includes(normalizedText) && current !== "MANUAL_REVIEW" && current !== "AWAITING_PAYMENT") {
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
      await resendCurrentQuestion(tx, updated, customer.phoneE164, current);
      return { advanced: false, reason: "QUESTION_REPEATED" as const };
    }
    if (["FALAR COM ALGUEM", "LIGACAO", "LIGAR"].includes(normalizedText)) {
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date(), version: { increment: 1 } },
      });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload("Certo. Uma pessoa da AllSet continuará seu atendimento."),
        idempotencyKey: `customer-booking:${updated.id}:human-help:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "HUMAN_HELP_REQUESTED" as const };
    }
    if (current === "MANUAL_REVIEW") {
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload("Seu pedido está sendo revisado. Vamos continuar por aqui assim que possível."),
        idempotencyKey: `customer-booking:${updated.id}:manual-review-follow-up:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "MANUAL_REVIEW" as const };
    }
    if (current === "AWAITING_PAYMENT") {
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload("Seu pedido continua aguardando pagamento. Enviaremos as instruções por aqui."),
        idempotencyKey: `customer-booking:${updated.id}:awaiting-payment-follow-up:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: false, reason: "AWAITING_PAYMENT" as const };
    }

    if (input.text.trim().toUpperCase() === "PARAR") {
      await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { state: "PAUSED", automationPausedAt: new Date(), lastInboundAt: new Date(), version: { increment: 1 } },
      });
      return { advanced: false, reason: "STOPPED" as const };
    }

    if (current === "INTRODUCTION") {
      const answer = parseCustomerChoice(current, input.text);
      if (answer === "NO") {
        await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "COMPLETED", lastInboundAt: new Date() } });
        return { advanced: false, reason: "DECLINED" as const };
      }
      if (answer !== "YES") {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "INTRODUCTION");
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "NAME", lastQuestionKey: "NAME", lastInboundAt: new Date(), version: { increment: 1 } } });
      await enqueueQuestion(tx, updated, customer.phoneE164, "NAME");
      return { advanced: true, state: "NAME" as const };
    }

    if (current === "NAME") {
      const name = input.text.trim();
      if (name.length < 2 || name.length > 120) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "NAME");
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      await tx.user.update({ where: { id: customer.id }, data: { fullName: name } });
      const tiers = await activePricingTiers(tx);
      const nextState: CustomerConversationState = tiers.length ? "PROPERTY_CHARACTERISTICS" : "MANUAL_REVIEW";
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: nextState, lastQuestionKey: nextState, lastInboundAt: new Date(), version: { increment: 1 } } });
      if (!tiers.length) {
        await enqueueManualReviewNotice(tx, updated, customer.phoneE164);
        return { advanced: false, reason: "PRICING_NOT_CONFIGURED" as const };
      }
      await enqueueQuestion(tx, updated, customer.phoneE164, nextState, pricingTierText(tiers));
      return { advanced: true, state: nextState };
    }

    if (current === "PROPERTY_CHARACTERISTICS") {
      const tiers = await activePricingTiers(tx);
      const numericChoice = Number(input.text.trim());
      const tier = Number.isInteger(numericChoice) ? tiers[numericChoice - 1] : undefined;
      if (!tier) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, current, pricingTierText(tiers));
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const service = await tx.serviceDefinition.findFirst({ where: { isActive: true }, orderBy: { code: "asc" } });
      if (!service) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "MANUAL_REVIEW", lastQuestionKey: "MANUAL_REVIEW", lastInboundAt: new Date() } });
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
        const collecting = await transitionBookingStatusInTransaction(tx, { bookingId: booking.id, targetStatus: "COLLECTING_DATA", actor: "system:customer-conversation" });
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
      await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_DATE", scheduleDateText());
      return { advanced: true, state: "SCHEDULE_DATE" as const, bookingId: booking.id };
    }

    if (current === "SCHEDULE_DATE") {
      const scheduleDate = parseScheduleDateChoice(input.text);
      if (!scheduleDate || !conversation.bookingId) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_DATE", scheduleDateText());
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { pendingScheduleDate: scheduleDate, state: "SCHEDULE_TIME", lastQuestionKey: "SCHEDULE_TIME", lastInboundAt: new Date(), version: { increment: 1 } },
      });
      await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_TIME");
      return { advanced: true, state: "SCHEDULE_TIME" as const };
    }

    if (current === "SCHEDULE_TIME") {
      const scheduleTime = parseScheduleTimeChoice(input.text);
      if (!scheduleTime || !conversation.pendingScheduleDate || !conversation.bookingId) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_TIME");
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const scheduledAt = scheduledAtFromFortalezaLocal(conversation.pendingScheduleDate, scheduleTime);
      if (!scheduledAt || scheduledAt <= new Date()) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { pendingScheduleDate: null, state: "SCHEDULE_DATE", lastQuestionKey: "SCHEDULE_DATE", lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "SCHEDULE_DATE", scheduleDateText());
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const booking = await tx.booking.findUnique({ where: { id: conversation.bookingId }, include: { propertyPricingTier: true } });
      if (!booking?.propertyPricingTier) return { advanced: false, reason: "BOOKING_NOT_CONFIGURED" as const };
      await tx.booking.update({ where: { id: booking.id }, data: { scheduledAt } });
      const quoted = await transitionBookingStatusInTransaction(tx, { bookingId: booking.id, targetStatus: "QUOTED", actor: "system:customer-conversation" });
      if (!quoted.ok) throw quoted.error;
      await tx.booking.update({ where: { id: booking.id }, data: { quotedAt: new Date() } });
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: { pendingScheduleDate: null, state: "QUOTE_ACCEPTANCE", lastQuestionKey: "QUOTE_ACCEPTANCE", lastInboundAt: new Date(), version: { increment: 1 } },
      });
      await enqueueQuestion(tx, updated, customer.phoneE164, "QUOTE_ACCEPTANCE", `${quoteText(booking.propertyPricingTier)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`);
      return { advanced: true, state: "QUOTE_ACCEPTANCE" as const, bookingId: booking.id };
    }

    if (current === "QUOTE_ACCEPTANCE") {
      const answer = parseCustomerChoice(current, input.text);
      if (answer === "CHANGE") {
        if (!conversation.bookingId) return { advanced: false, reason: "INVALID_ANSWER" as const };
        const collecting = await transitionBookingStatusInTransaction(tx, { bookingId: conversation.bookingId, targetStatus: "COLLECTING_DATA", actor: "customer:whatsapp", reason: "Cliente solicitou alteração no orçamento" });
        if (!collecting.ok) throw collecting.error;
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "PROPERTY_CHARACTERISTICS", lastQuestionKey: "PROPERTY_CHARACTERISTICS", lastInboundAt: new Date(), version: { increment: 1 } } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "PROPERTY_CHARACTERISTICS", pricingTierText(await activePricingTiers(tx)));
        return { advanced: true, state: "PROPERTY_CHARACTERISTICS" as const };
      }
      if (answer !== "ACCEPT" || !conversation.bookingId) {
        const booking = conversation.bookingId
          ? await tx.booking.findUnique({ where: { id: conversation.bookingId }, include: { propertyPricingTier: true } })
          : null;
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        const text = booking?.propertyPricingTier
          ? `${quoteText(booking.propertyPricingTier)}\n\nQuer seguir com este valor?\n\n1 — Confirmar e continuar\n2 — Alterar informações`
          : undefined;
        await enqueueQuestion(tx, updated, customer.phoneE164, "QUOTE_ACCEPTANCE", text);
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const accepted = await transitionBookingStatusInTransaction(tx, { bookingId: conversation.bookingId, targetStatus: "QUOTE_ACCEPTED", actor: "customer:whatsapp" });
      if (!accepted.ok) throw accepted.error;
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "ADDRESS", lastQuestionKey: "ADDRESS", lastInboundAt: new Date(), version: { increment: 1 } } });
      await enqueueCustomerQuestion(tx, { conversationId: updated.id, provider: updated.provider, recipient: customer.phoneE164, state: "ADDRESS", text: "Agora envie o endereço completo do atendimento. Ele será usado apenas para validar a área atendida." , idempotencyKey: `customer-booking:${updated.id}:ADDRESS:${updated.updatedAt.getTime()}` });
      return { advanced: true, state: "ADDRESS" as const };
    }

    if (current === "ADDRESS") {
      const address = input.text.trim();
      if (address.length < 8 || address.length > 500 || !conversation.bookingId) {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueCustomerQuestion(tx, { conversationId: updated.id, provider: updated.provider, recipient: customer.phoneE164, state: "ADDRESS", text: "Envie o endereço completo do atendimento para validarmos a área atendida.", idempotencyKey: `customer-booking:${updated.id}:ADDRESS:retry:${updated.updatedAt.getTime()}` });
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      await tx.booking.update({ where: { id: conversation.bookingId }, data: { addressLine1: address } });
      const review = await transitionBookingStatusInTransaction(tx, { bookingId: conversation.bookingId, targetStatus: "REVIEW_REQUIRED", actor: "system:customer-conversation", reason: "Endereço aguarda validação de cobertura" });
      if (!review.ok) throw review.error;
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "MANUAL_REVIEW", lastQuestionKey: "MANUAL_REVIEW", lastInboundAt: new Date(), version: { increment: 1 } } });
      await enqueueManualReviewNotice(tx, updated, customer.phoneE164);
      return { advanced: true, state: "MANUAL_REVIEW" as const };
    }

    if (current === "FINAL_CONFIRMATION") {
      const answer = parseCustomerChoice(current, input.text);
      if (!conversation.bookingId) return { advanced: false, reason: "INVALID_ANSWER" as const };
      if (answer === "CHANGE") {
        const collecting = await transitionBookingStatusInTransaction(tx, { bookingId: conversation.bookingId, targetStatus: "COLLECTING_DATA", actor: "customer:whatsapp", reason: "Cliente solicitou alteração após validar endereço" });
        if (!collecting.ok) throw collecting.error;
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "PROPERTY_CHARACTERISTICS", lastQuestionKey: "PROPERTY_CHARACTERISTICS", lastInboundAt: new Date(), version: { increment: 1 } } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "PROPERTY_CHARACTERISTICS", pricingTierText(await activePricingTiers(tx)));
        return { advanced: true, state: "PROPERTY_CHARACTERISTICS" as const };
      }
      if (answer !== "PAY") {
        const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date() } });
        await enqueueQuestion(tx, updated, customer.phoneE164, "FINAL_CONFIRMATION");
        return { advanced: false, reason: "INVALID_ANSWER" as const };
      }
      const awaitingPayment = await transitionBookingStatusInTransaction(tx, { bookingId: conversation.bookingId, targetStatus: "AWAITING_PAYMENT", actor: "customer:whatsapp" });
      if (!awaitingPayment.ok) throw awaitingPayment.error;
      const updated = await tx.customerBookingConversation.update({ where: { id: conversation.id }, data: { state: "AWAITING_PAYMENT", lastQuestionKey: "AWAITING_PAYMENT", lastInboundAt: new Date(), version: { increment: 1 } } });
      await enqueueOutboundMessage(tx, {
        provider: updated.provider,
        recipient: customer.phoneE164,
        payload: textPayload("Pedido aguardando pagamento. Enviaremos as instruções de pagamento por aqui."),
        idempotencyKey: `customer-booking:${updated.id}:AWAITING_PAYMENT:${updated.updatedAt.getTime()}`,
        correlationId: updated.id,
        actor: "system:customer-conversation",
      });
      return { advanced: true, state: "AWAITING_PAYMENT" as const };
    }

    return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
  });
}
