import {
  Prisma,
  type Booking,
  type CustomerBookingConversation,
  type PrismaClient,
  type PropertyPricingTier,
} from "@prisma/client";
import {
  parseCustomerChoice,
  type CustomerConversationState,
} from "../../domain/customer/customer-conversation-definition";
import {
  customerScheduleDateChoices,
  interpretScheduleReply,
  parseScheduleTimeChoice,
  scheduledAtFromFortalezaLocal,
} from "../../domain/customer/customer-schedule";
import { extractNeighborhood } from "../../domain/customer/customer-address";
import { textPayload } from "../../domain/messaging/message";
import { transitionBookingStatusInTransaction } from "../booking/transition-booking-status.usecase";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { notifyOpportunityInTransaction } from "../marketplace/notify-opportunity.usecase";
import { enqueueCustomerQuestion } from "./customer-question-outbox";
import {
  customerBookingDetails,
  customerBookingSummary,
  estimatedValueText,
  formatScheduleForCustomer,
} from "../../domain/customer/customer-booking-summary";
import { supersedeCustomerPrompts } from "./supersede-customer-prompts";
import { z } from "zod";
import { ok, err } from "../../domain/shared/result";
import { DomainError } from "../../domain/shared/domain-error";
import { customerResumeStep, isCustomerAdminStep } from "../../domain/customer/customer-admin-controls";
import type { BookingStatus } from "../../domain/booking/booking-status";
import { ALLOWED_TRANSITIONS } from "../../domain/booking/booking-state-machine";

function pricingTierText(tiers: readonly PropertyPricingTier[]): string {
  return [
    "Qual opção descreve melhor o seu imóvel?",
    "",
    ...tiers.map((tier, index) => `${index + 1} — ${tier.label}`),
  ].join("\n");
}

/** Confirms what was understood (day, time, estimated value) before moving on. */
function scheduleConfirmationText(booking: {
  scheduledAt: Date | null;
  totalCents: number;
  durationMinutes: number | null;
}): string {
  return [
    booking.scheduledAt
      ? `Entendi: ${formatScheduleForCustomer(booking.scheduledAt)}.`
      : "Confira o dia e horário:",
    "",
    estimatedValueText(booking.totalCents),
    `Duração prevista: ${booking.durationMinutes ?? 180} minutos`,
    "",
    "Está correto?",
    "",
    "1 — Confirmar",
    "2 — Alterar dia ou horário",
  ].join("\n");
}

function scheduleDateText(prefix?: string): string {
  return [
    ...(prefix ? [prefix, ""] : []),
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

function scheduleTimeText(isoDate?: string | null, prefix?: string): string {
  const day = isoDate ? isoDate.split("-").reverse().slice(0, 2).join("/") : null;
  return [
    ...(prefix ? [prefix, ""] : []),
    day ? `Para ${day}, qual horário você prefere?` : "Qual horário você prefere?",
    "",
    "1 — 08:00",
    "2 — 09:00",
    "3 — 13:00",
    "4 — 14:00",
  ].join("\n");
}

function unavailableTimeText(hour: number, minute: number): string {
  const label = minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, "0")}`;
  return `Não atendemos às ${label}. Os horários disponíveis são 8h, 9h, 13h ou 14h.`;
}

const ADDRESS_PROMPT =
  "Agora envie o endereço completo do atendimento (rua, número e bairro).";

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
  text?: string,
  actor = "system:customer-conversation",
): Promise<void> {
  await enqueueCustomerQuestion(tx, {
    conversationId: conversation.id,
    provider: conversation.provider,
    recipient,
    state,
    actor,
    ...(text !== undefined ? { text } : {}),
    idempotencyKey: `customer-booking:${conversation.id}:${state}:v${conversation.version}:${conversation.updatedAt.getTime()}`,
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
      "Recebemos seu pedido. Nossa equipe vai continuar o atendimento por aqui em breve."
    ),
    idempotencyKey: `customer-booking:${conversation.id}:manual-review:v${conversation.version}:${conversation.updatedAt.getTime()}`,
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
  state: CustomerConversationState,
  actor = "system:customer-conversation",
): Promise<void> {
  if (state === "PROPERTY_CHARACTERISTICS") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      pricingTierText(await activePricingTiers(tx)),
      actor,
    );
    return;
  }
  if (state === "SCHEDULE_DATE") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      scheduleDateText(),
      actor,
    );
    return;
  }
  if (state === "SCHEDULE_TIME") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      scheduleTimeText(conversation.pendingScheduleDate),
      actor,
    );
    return;
  }
  if (state === "QUOTE_ACCEPTANCE" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({
      where: { id: conversation.bookingId },
    });
    if (booking?.scheduledAt) {
      await enqueueQuestion(
        tx,
        conversation,
        recipient,
        state,
        scheduleConfirmationText(booking),
        actor,
      );
      return;
    }
  }
  if (state === "ADDRESS") {
    await enqueueQuestion(tx, conversation, recipient, state, ADDRESS_PROMPT, actor);
    return;
  }
  if (state === "FINAL_CONFIRMATION" && conversation.bookingId) {
    const booking = await tx.booking.findUnique({
      where: { id: conversation.bookingId },
    });
    if (booking) {
      await enqueueQuestion(
        tx,
        conversation,
        recipient,
        state,
        customerBookingSummary(booking),
        actor,
      );
      return;
    }
  }
  if (state === "MANUAL_REVIEW") {
    await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient,
      payload: textPayload(
        "Seu pedido está sendo revisado. Vamos continuar por aqui assim que possível."
      ),
      idempotencyKey: `customer-booking:${conversation.id}:${state}:resumed:v${conversation.version}:${conversation.updatedAt.getTime()}`,
      correlationId: conversation.id,
      actor,
    });
    return;
  }
  await enqueueQuestion(tx, conversation, recipient, state, undefined, actor);
}

/**
 * Hands the booking to matching: the opportunity is offered to professionals
 * in the same transaction that closes the customer conversation. There is no
 * payment step — AllSet only connects customer and professional.
 */
async function sendBookingToMatching(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  booking: Booking,
  neighborhood: string,
  options: { prefix?: string } = {},
) {
  const actor = "system:customer-conversation";
  // Bring bookings that are still collecting data to the state matching expects.
  let status = booking.status as BookingStatus;
  if (status === "COLLECTING_DATA") {
    const quoted = await transitionBookingStatusInTransaction(tx, {
      bookingId: booking.id,
      targetStatus: "QUOTED",
      actor,
    });
    if (!quoted.ok) throw quoted.error;
    status = "QUOTED";
  }
  if (status === "QUOTED") {
    const confirmed = await transitionBookingStatusInTransaction(tx, {
      bookingId: booking.id,
      targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
      actor,
      reason: "Pedido completo; segue direto para as profissionais",
    });
    if (!confirmed.ok) throw confirmed.error;
  }
  const prepared = await tx.booking.update({
    where: { id: booking.id },
    data: {
      neighborhood,
      // Sem validação de cobertura: o endereço é registrado e o pedido segue.
      coverageValidatedAt: booking.coverageValidatedAt ?? new Date(),
      outsideCoverageArea: false,
      professionalPaymentCents:
        booking.professionalPaymentCents ??
        (booking.totalCents > 0 ? booking.totalCents : null),
    },
  });
  const result = await notifyOpportunityInTransaction(tx, {
    bookingId: booking.id,
    actor,
  });
  const updated = await tx.customerBookingConversation.update({
    where: { id: conversation.id },
    data: {
      state: "COMPLETED",
      lastQuestionKey: "COMPLETED",
      pendingScheduleDate: null,
      lastInboundAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (result.dispatched) {
    await enqueueOutboundMessage(tx, {
      provider: updated.provider,
      recipient,
      payload: textPayload(
        [
          ...(options.prefix ? [options.prefix, ""] : []),
          "Pronto! Enviamos o seu pedido para as profissionais disponíveis:",
          "",
          ...customerBookingDetails(prepared),
          "",
          "Assim que uma delas aceitar, você recebe aqui o nome e o WhatsApp dela para combinarem direto o horário e o valor.",
          "A AllSet apenas conecta vocês; não há cobrança pela plataforma.",
        ].join("\n")
      ),
      idempotencyKey: `customer-booking:${updated.id}:matching-requested:${updated.updatedAt.getTime()}`,
      correlationId: updated.id,
      actor,
    });
  }
  return {
    advanced: true,
    state: "COMPLETED" as const,
    bookingId: booking.id,
    dispatched: result.dispatched,
    reason: undefined,
  };
}

/**
 * After the address is known: ask the bairro only when it cannot be read from
 * the address, otherwise go straight to matching.
 */
async function continueAfterAddress(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  bookingId: string,
  options: { prefix?: string } = {},
) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const neighborhood =
    booking.neighborhood ??
    (booking.addressLine1 ? extractNeighborhood(booking.addressLine1) : undefined);
  if (!neighborhood) {
    const updated = await tx.customerBookingConversation.update({
      where: { id: conversation.id },
      data: {
        state: "NEIGHBORHOOD",
        lastQuestionKey: "NEIGHBORHOOD",
        lastInboundAt: new Date(),
        version: { increment: 1 },
      },
    });
    await enqueueQuestion(tx, updated, recipient, "NEIGHBORHOOD");
    return { advanced: true, state: "NEIGHBORHOOD" as const, reason: undefined };
  }
  return sendBookingToMatching(tx, conversation, recipient, booking, neighborhood, options);
}

/**
 * Stores a day/time the customer asked for and asks them to confirm exactly
 * what was understood. Anything not understood or in the past is asked again.
 */
async function proposeSchedule(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  date: string,
  time: string,
) {
  const retry = (prefix: string) =>
    recordInvalidAnswer(
      tx,
      conversation,
      recipient,
      "SCHEDULE_DATE",
      (updated) =>
        enqueueQuestion(tx, updated, recipient, "SCHEDULE_DATE", scheduleDateText(prefix)),
      {
        pendingScheduleDate: null,
        state: "SCHEDULE_DATE",
        lastQuestionKey: "SCHEDULE_DATE",
      }
    );
  const scheduledAt = scheduledAtFromFortalezaLocal(date, time);
  if (!scheduledAt || scheduledAt <= new Date() || !conversation.bookingId) {
    return retry("Esse dia e horário não estão disponíveis (já passaram ou são inválidos).");
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
      recipient,
      payload: textPayload(
        "Houve uma atualização nos serviços disponíveis. Nossa equipe entrará em contato para concluir seu agendamento."
      ),
      idempotencyKey: `customer-booking:${updated.id}:booking-misconfigured:${updated.updatedAt.getTime()}`,
      correlationId: updated.id,
      actor: "system:customer-conversation",
    });
    return { advanced: false, reason: "BOOKING_NOT_CONFIGURED" as const };
  }
  const withSchedule = await tx.booking.update({
    where: { id: booking.id },
    data: { scheduledAt, quotedAt: new Date() },
  });
  if (booking.status !== "QUOTED") {
    const quoted = await transitionBookingStatusInTransaction(tx, {
      bookingId: booking.id,
      targetStatus: "QUOTED",
      actor: "system:customer-conversation",
    });
    if (!quoted.ok) throw quoted.error;
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
    recipient,
    "QUOTE_ACCEPTANCE",
    scheduleConfirmationText(withSchedule)
  );
  return {
    advanced: true,
    state: "QUOTE_ACCEPTANCE" as const,
    bookingId: booking.id,
    reason: undefined,
  };
}

const adminControlSchema = z.object({
  conversationId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  actor: z.string().trim().min(1).max(160),
  action: z.enum(["resume", "pause", "step", "restart", "close"]),
  step: z.string().optional(),
});

/** Administrative overrides share the inbound engine's customer lock and transaction. */
export async function controlCustomerConversation(
  prisma: PrismaClient,
  rawInput: z.input<typeof adminControlSchema>
) {
  const parsed = adminControlSchema.safeParse(rawInput);
  if (!parsed.success) return err("Dados da ação inválidos.");
  const input = parsed.data;
  return prisma.$transaction(async (tx) => {
    const owner = await tx.customerBookingConversation.findUnique({
      where: { id: input.conversationId },
      select: { customerId: true },
    });
    if (!owner) return err("Conversa não encontrada.");
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.customerId} FOR UPDATE`;
    const current = await tx.customerBookingConversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: { customer: true, booking: true },
    });
    if (current.version !== input.expectedVersion)
      return err("A conversa mudou. Atualize a página e tente novamente.");
    if (current.state === "COMPLETED" && input.action !== "restart")
      return err("Esta conversa está encerrada. Reinicie para continuar.");
    const booking = current.booking;
    let target: CustomerConversationState;
    if (input.action === "resume") {
      const step = customerResumeStep({ ...current, hasBooking: !!booking });
      if (!step) return err("Esta conversa não está pausada ou em revisão.");
      target = step;
    } else if (input.action === "step") {
      if (!isCustomerAdminStep(input.step ?? null))
        return err("Etapa inválida.");
      target = input.step as CustomerConversationState;
    } else
      target =
        input.action === "pause"
          ? "PAUSED"
          : input.action === "close"
            ? "COMPLETED"
            : "INTRODUCTION";

    // Validate prerequisites before writing anything. Never fabricate customer consent.
    if (target === "PROPERTY_CHARACTERISTICS" && !(await activePricingTiers(tx)).length)
      return err("Configure as opções de preço antes de retomar esta etapa.");
    const needsBooking = [
      "SCHEDULE_DATE",
      "SCHEDULE_TIME",
      "QUOTE_ACCEPTANCE",
      "ADDRESS",
      "NEIGHBORHOOD",
      "FINAL_CONFIRMATION",
      "EDIT_SELECTION",
    ].includes(target);
    if (needsBooking && !booking)
      return err(
        "Esta etapa exige um pedido. Colete primeiro as características do imóvel."
      );
    if (target === "SCHEDULE_TIME" && !current.pendingScheduleDate)
      return err("Escolha primeiro uma data na etapa SCHEDULE_DATE.");
    if (
      ["QUOTE_ACCEPTANCE", "FINAL_CONFIRMATION", "EDIT_SELECTION"].includes(
        target
      ) &&
      (!booking?.propertyPricingTierId || !booking.scheduledAt)
    )
      return err("Esta etapa exige imóvel e horário definidos.");
    if (
      ["FINAL_CONFIRMATION", "EDIT_SELECTION"].includes(target) &&
      !booking?.addressLine1
    )
      return err("Esta etapa exige o endereço do cliente.");

    let bookingTarget: BookingStatus | null = null;
    if (
      booking &&
      ["restart", "close"].includes(input.action) &&
      booking.status !== "CANCELLED"
    )
      bookingTarget = "CANCELLED";
    else if (booking && !["pause", "close", "restart"].includes(input.action)) {
      if (
        [
          "INTRODUCTION",
          "NAME",
          "PROPERTY_CHARACTERISTICS",
          "SCHEDULE_DATE",
          "SCHEDULE_TIME",
        ].includes(target)
      )
        bookingTarget = "COLLECTING_DATA";
      if (target === "QUOTE_ACCEPTANCE") bookingTarget = "QUOTED";
      if (
        target === "ADDRESS" &&
        !["COLLECTING_DATA", "QUOTE_ACCEPTED", "REVIEW_REQUIRED"].includes(
          booking.status
        )
      )
        bookingTarget = "COLLECTING_DATA";
      if (["FINAL_CONFIRMATION", "EDIT_SELECTION"].includes(target))
        bookingTarget = "AWAITING_CUSTOMER_CONFIRMATION";
      if (
        ["ADDRESS", "NEIGHBORHOOD"].includes(target) &&
        [
          "PAID",
          "CANCELLED",
          "COMPLETED",
          "MATCHING",
          "AWAITING_PAYMENT",
        ].includes(booking.status)
      )
        return err("O status deste pedido não permite retornar ao endereço.");
    }
    if (
      booking &&
      bookingTarget &&
      booking.status !== bookingTarget &&
      !ALLOWED_TRANSITIONS[booking.status].includes(bookingTarget)
    )
      return err(
        "O status do pedido não permite esta alteração. Resolva o pedido em Agendamentos."
      );
    if (!["PAUSED", "COMPLETED"].includes(target)) {
      const other = await tx.customerBookingConversation.findFirst({
        where: {
          customerId: current.customerId,
          id: { not: current.id },
          state: { not: "COMPLETED" },
        },
        select: { id: true },
      });
      if (other)
        return err(
          "Este cliente possui outra conversa aberta. Encerre a outra conversa antes de ativar esta."
        );
    }
    const claimed = await tx.customerBookingConversation.updateMany({
      where: { id: current.id, version: input.expectedVersion },
      data: {
        state: target,
        lastQuestionKey:
          target === "PAUSED"
            ? isCustomerAdminStep(current.state)
              ? current.state
              : current.lastQuestionKey
            : target,
        automationPausedAt: ["PAUSED", "COMPLETED"].includes(target)
          ? new Date()
          : null,
        misunderstandingCount: 0,
        misunderstandingState: null,
        lastInboundAt: new Date(),
        lastReengagementAt: null,
        ...(input.action === "restart"
          ? { bookingId: null, pendingScheduleDate: null }
          : {}),
        ...(target === "SCHEDULE_DATE" ? { pendingScheduleDate: null } : {}),
        version: { increment: 1 },
      },
    });
    if (!claimed.count)
      return err("A conversa mudou. Atualize a página e tente novamente.");
    if (booking && bookingTarget && booking.status !== bookingTarget) {
      const transition = await transitionBookingStatusInTransaction(tx, {
        bookingId: booking.id,
        expectedVersion: booking.version,
        targetStatus: bookingTarget,
        actor: input.actor,
        reason: `Controle administrativo: ${input.action}`,
      });
      // Roll back the conversation claim if the booking changed concurrently.
      if (!transition.ok) throw transition.error;
    }
    const conversation = await tx.customerBookingConversation.findUniqueOrThrow(
      { where: { id: current.id } }
    );
    const superseded = await supersedeCustomerPrompts(tx, current.id);
    await recordAuditLog(tx, {
      actor: input.actor,
      action: `CUSTOMER_CONVERSATION_${input.action.toUpperCase()}`,
      entityType: "CustomerBookingConversation",
      entityId: current.id,
      metadata: {
        fromState: current.state,
        toState: target,
        bookingId: current.bookingId,
        fromVersion: current.version,
        version: conversation.version,
        supersededPrompts: superseded.count,
        reason:
          input.action === "pause"
            ? "Admin assumiu o atendimento"
            : input.action,
      },
    });
    if (!["PAUSED", "COMPLETED"].includes(target))
      await resendCurrentQuestion(
        tx,
        conversation,
        current.customer.phoneE164,
        target,
        input.actor
      );
    return ok({ conversationId: conversation.id });
  }).catch((error: unknown) => {
    // Domain failures must abort all writes, then become recoverable UI errors.
    if (error instanceof DomainError) return err(error.message);
    throw error;
  });
}

export async function resumeCustomerBookingConversation(
  prisma: PrismaClient,
  input: {
    bookingId?: string;
    conversationId?: string;
    expectedVersion?: number;
    actor: string;
  }
) {
  const current = await prisma.customerBookingConversation.findUnique({
    where: input.conversationId
      ? { id: input.conversationId }
      : { bookingId: input.bookingId ?? "" },
  });
  if (!current) return err("Conversa não encontrada.");
  return controlCustomerConversation(prisma, {
    conversationId: current.id,
    expectedVersion: input.expectedVersion ?? current.version,
    actor: input.actor,
    action: "resume",
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
    if (!active && !needsName && !tiers.length) {
      await enqueueManualReviewNotice(tx, conversation, customer.phoneE164);
      return { started: true as const, conversation, reason: "PRICING_NOT_CONFIGURED" as const };
    }
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

    // Conversas que pararam em revisão de cobertura antes de a validação
    // deixar de existir: no próximo contato do cliente seguem para o matching.
    if (current === "MANUAL_REVIEW") {
      const stuck = conversation.bookingId
        ? await tx.booking.findUnique({ where: { id: conversation.bookingId } })
        : null;
      if (
        stuck?.addressLine1 &&
        stuck.scheduledAt &&
        ["REVIEW_REQUIRED", "AWAITING_CUSTOMER_CONFIRMATION", "QUOTE_ACCEPTED"].includes(stuck.status)
      ) {
        return continueAfterAddress(tx, conversation, customer.phoneE164, stuck.id);
      }
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
    // Pedidos que aguardavam pagamento: a plataforma não cobra mais, então
    // seguem direto para as profissionais.
    if (current === "AWAITING_PAYMENT") {
      if (conversation.bookingId) {
        return continueAfterAddress(tx, conversation, customer.phoneE164, conversation.bookingId, {
          prefix: "Não é mais necessário pagamento pela AllSet. Seu pedido segue direto para as profissionais.",
        });
      }
      return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
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
      const understood = interpretScheduleReply(input.text);
      if (understood.status === "slot" && conversation.bookingId) {
        return proposeSchedule(
          tx,
          conversation,
          customer.phoneE164,
          understood.date,
          understood.time
        );
      }
      if (understood.status === "date_only" && conversation.bookingId) {
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            pendingScheduleDate: understood.date,
            state: "SCHEDULE_TIME",
            lastQuestionKey: "SCHEDULE_TIME",
            misunderstandingCount: 0,
            misunderstandingState: null,
            lastInboundAt: new Date(),
            version: { increment: 1 },
          },
        });
        await enqueueQuestion(
          tx,
          updated,
          customer.phoneE164,
          "SCHEDULE_TIME",
          scheduleTimeText(understood.date)
        );
        return { advanced: true, state: "SCHEDULE_TIME" as const };
      }
      const prefix =
        understood.status === "time_unavailable"
          ? unavailableTimeText(understood.hour, understood.minute)
          : understood.status === "time_only"
            ? `Entendi o horário das ${Number(understood.time.slice(0, 2))}h, mas preciso saber o dia.`
            : "Não consegui entender o dia e o horário.";
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
            scheduleDateText(prefix)
          )
      );
    }

    if (current === "SCHEDULE_TIME") {
      if (!conversation.pendingScheduleDate || !conversation.bookingId) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_TIME",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "SCHEDULE_TIME",
              scheduleTimeText(updated.pendingScheduleDate)
            )
        );
      }
      // A reply that carries its own day ("amanhã 14h") wins; otherwise the
      // answer is the time for the day already chosen.
      const understood = interpretScheduleReply(input.text);
      if (understood.status === "slot") {
        return proposeSchedule(
          tx,
          conversation,
          customer.phoneE164,
          understood.date,
          understood.time
        );
      }
      const scheduleTime =
        understood.status === "time_unavailable"
          ? undefined
          : parseScheduleTimeChoice(input.text);
      if (!scheduleTime) {
        const prefix =
          understood.status === "time_unavailable"
            ? unavailableTimeText(understood.hour, understood.minute)
            : "Não consegui entender o horário.";
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_TIME",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "SCHEDULE_TIME",
              scheduleTimeText(updated.pendingScheduleDate, prefix)
            )
        );
      }
      return proposeSchedule(
        tx,
        conversation,
        customer.phoneE164,
        conversation.pendingScheduleDate,
        scheduleTime
      );
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
          reason: "Cliente solicitou alteração de dia ou horário",
        });
        if (!collecting.ok) throw collecting.error;
        await tx.booking.update({
          where: { id: conversation.bookingId },
          data: { scheduledAt: null },
        });
        const updated = await tx.customerBookingConversation.update({
          where: { id: conversation.id },
          data: {
            pendingScheduleDate: null,
            state: "SCHEDULE_DATE",
            lastQuestionKey: "SCHEDULE_DATE",
            misunderstandingCount: 0,
            misunderstandingState: null,
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
      if (answer !== "ACCEPT" || !conversation.bookingId) {
        const booking = conversation.bookingId
          ? await tx.booking.findUnique({
              where: { id: conversation.bookingId },
            })
          : null;
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "QUOTE_ACCEPTANCE",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "QUOTE_ACCEPTANCE",
              booking?.scheduledAt ? scheduleConfirmationText(booking) : undefined
            )
        );
      }
      const pending = await tx.booking.findUniqueOrThrow({
        where: { id: conversation.bookingId },
      });
      if (pending.status === "QUOTED") {
        const accepted = await transitionBookingStatusInTransaction(tx, {
          bookingId: conversation.bookingId,
          targetStatus: "QUOTE_ACCEPTED",
          actor: "customer:whatsapp",
        });
        if (!accepted.ok) throw accepted.error;
      }
      // Customers editing only the schedule already gave the address.
      if (pending.addressLine1) {
        return continueAfterAddress(
          tx,
          conversation,
          customer.phoneE164,
          conversation.bookingId
        );
      }
      const updated = await tx.customerBookingConversation.update({
        where: { id: conversation.id },
        data: {
          state: "ADDRESS",
          lastQuestionKey: "ADDRESS",
          misunderstandingCount: 0,
          misunderstandingState: null,
          lastInboundAt: new Date(),
          version: { increment: 1 },
        },
      });
      await enqueueCustomerQuestion(tx, {
        conversationId: updated.id,
        provider: updated.provider,
        recipient: customer.phoneE164,
        state: "ADDRESS",
        text: ADDRESS_PROMPT,
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
              text: `Não consegui ler o endereço. ${ADDRESS_PROMPT}`,
              idempotencyKey: `customer-booking:${updated.id}:ADDRESS:retry:${updated.updatedAt.getTime()}`,
            })
        );
      }
      // O endereço é guardado no pedido, sem etapa de validação de cobertura:
      // o pedido segue direto para as profissionais.
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data: {
          addressLine1: address,
          coverageValidatedAt: new Date(),
          outsideCoverageArea: false,
          neighborhood: extractNeighborhood(address) ?? null,
        },
      });
      return continueAfterAddress(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "NEIGHBORHOOD") {
      const neighborhood = input.text.trim();
      if (
        neighborhood.length < 2 ||
        neighborhood.length > 120 ||
        !conversation.bookingId
      ) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "NEIGHBORHOOD",
          (updated) =>
            enqueueQuestion(tx, updated, customer.phoneE164, "NEIGHBORHOOD")
        );
      }
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data: { neighborhood },
      });
      return continueAfterAddress(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
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
      if (answer !== "CONFIRM") {
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
      return continueAfterAddress(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
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
        "Envie o novo endereço completo (rua, número e bairro)."
      );
      return { advanced: true, state: "ADDRESS" as const };
    }

    return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
  });
}
