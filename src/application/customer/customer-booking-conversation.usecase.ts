import type {
  Booking,
  CustomerBookingConversation,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  CUSTOMER_QUESTIONS,
  parseCustomerChoice,
  SERVICE_DETAILS_PROMPT,
  type CustomerConversationState,
} from "../../domain/customer/customer-conversation-definition";
import {
  CUSTOMER_SCHEDULE_EARLIEST_HOUR,
  CUSTOMER_SCHEDULE_LATEST_HOUR,
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
  customerBookingInProgressText,
  customerBookingSummary,
  formatScheduleForCustomer,
} from "../../domain/customer/customer-booking-summary";
import { supersedeCustomerPrompts } from "./supersede-customer-prompts";
import { z } from "zod";
import { ok, err } from "../../domain/shared/result";
import { DomainError } from "../../domain/shared/domain-error";
import {
  customerResumeStep,
  isCustomerAdminStep,
} from "../../domain/customer/customer-admin-controls";
import type { BookingStatus } from "../../domain/booking/booking-status";
import { ALLOWED_TRANSITIONS } from "../../domain/booking/booking-state-machine";

/*
 * Fluxo curto do contratante: nome (só na primeira vez) → dia e horário →
 * endereço (bairro só se não der para ler do endereço) → descrição livre do
 * serviço → resumo → envio às profissionais. Tipo de imóvel, valor e
 * pagamento são combinados direto entre cliente e profissional.
 */

function scheduleDateText(prefix?: string): string {
  return [
    ...(prefix ? [prefix, ""] : []),
    "Para qual dia e horário você precisa?",
    "Ex.: amanhã às 14h, sábado 9h ou 25/10 às 8h30.",
    "",
    "Se preferir, escolha primeiro o dia:",
    ...customerScheduleDateChoices().map(
      (choice, index) => `${index + 1} — ${choice.label}`
    ),
  ].join("\n");
}

function scheduleTimeText(isoDate?: string | null, prefix?: string): string {
  const day = isoDate
    ? isoDate.split("-").reverse().slice(0, 2).join("/")
    : null;
  return [
    ...(prefix ? [prefix, ""] : []),
    day
      ? `Para ${day}, qual horário você prefere?`
      : "Qual horário você prefere?",
    "Ex.: 9h ou 14h30.",
  ].join("\n");
}

function unavailableTimeText(hour: number, minute: number): string {
  const label =
    minute === 0 ? `${hour}h` : `${hour}h${String(minute).padStart(2, "0")}`;
  return `Não dá para marcar às ${label}. Escolha um horário entre ${CUSTOMER_SCHEDULE_EARLIEST_HOUR}h e ${CUSTOMER_SCHEDULE_LATEST_HOUR}h.`;
}

/** Pedidos do fluxo anterior que pararam na confirmação do horário. */
function legacyScheduleConfirmationText(scheduledAt: Date): string {
  return [
    `Entendi: ${formatScheduleForCustomer(scheduledAt)}.`,
    "",
    "Está correto?",
    "",
    "1 — Confirmar",
    "2 — Alterar dia ou horário",
  ].join("\n");
}

const ADDRESS_PROMPT =
  "Qual é o endereço completo do atendimento? (rua, número, complemento e bairro)";

const NEW_REQUEST_COMMANDS = [
  "NOVO",
  "NOVO PEDIDO",
  "OUTRO",
  "OUTRO PEDIDO",
  "MENU",
];

// Pedidos já enviados que ainda fazem sentido acompanhar pela conversa.
const IN_PROGRESS_BOOKING_STATUSES: readonly string[] = [
  "AWAITING_CUSTOMER_CONFIRMATION",
  "REVIEW_REQUIRED",
  "MATCHING",
  "PROFESSIONAL_ASSIGNED",
  "SCHEDULED",
  "PROFESSIONAL_CONFIRMED",
  "PROFESSIONAL_EN_ROUTE",
  "IN_PROGRESS",
  "AWAITING_COMPLETION_CONFIRMATION",
  "ISSUE_OPEN",
];

function withPrefix(text: string, prefix?: string): string {
  return prefix ? `${prefix}\n\n${text}` : text;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName.trim();
}

function editSelectionText(): string {
  const question = CUSTOMER_QUESTIONS.EDIT_SELECTION;
  return [
    question?.text ?? "O que você quer alterar?",
    "",
    ...(question?.choices ?? []).map(
      (choice, index) => `${index + 1} — ${choice.label}`
    ),
  ].join("\n");
}

async function enqueueQuestion(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState,
  text?: string,
  actor = "system:customer-conversation"
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
  actor = "system:customer-conversation"
): Promise<void> {
  if (state === "SCHEDULE_DATE") {
    await enqueueQuestion(
      tx,
      conversation,
      recipient,
      state,
      scheduleDateText(),
      actor
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
      actor
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
        legacyScheduleConfirmationText(booking.scheduledAt),
        actor
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
      ADDRESS_PROMPT,
      actor
    );
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
        actor
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

/** Moves the conversation to `state` and asks its question. */
async function askStep(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  state: CustomerConversationState,
  text: string,
  extraData: Prisma.CustomerBookingConversationUpdateInput = {}
) {
  const updated = await tx.customerBookingConversation.update({
    where: { id: conversation.id },
    data: {
      ...extraData,
      state,
      lastQuestionKey: state,
      misunderstandingCount: 0,
      misunderstandingState: null,
      lastInboundAt: new Date(),
      version: { increment: 1 },
    },
  });
  await enqueueQuestion(tx, updated, recipient, state, text);
  return { advanced: true as const, state, reason: undefined };
}

/**
 * Asks the first piece of information the booking still lacks, or shows the
 * summary once everything is known. Editing a field just clears it and calls
 * this again, so the customer comes straight back to the summary.
 */
async function advanceToNextStep(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  bookingId: string,
  options: { prefix?: string } = {}
) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  if (!booking.scheduledAt)
    return askStep(
      tx,
      conversation,
      recipient,
      "SCHEDULE_DATE",
      scheduleDateText(options.prefix),
      {
        pendingScheduleDate: null,
      }
    );
  if (!booking.addressLine1)
    return askStep(
      tx,
      conversation,
      recipient,
      "ADDRESS",
      withPrefix(ADDRESS_PROMPT, options.prefix)
    );
  const neighborhood =
    booking.neighborhood ?? extractNeighborhood(booking.addressLine1);
  if (!neighborhood)
    return askStep(
      tx,
      conversation,
      recipient,
      "NEIGHBORHOOD",
      withPrefix(
        CUSTOMER_QUESTIONS.NEIGHBORHOOD?.text ??
          "Qual é o bairro do atendimento?",
        options.prefix
      )
    );
  const withNeighborhood = booking.neighborhood
    ? booking
    : await tx.booking.update({
        where: { id: booking.id },
        data: { neighborhood },
      });
  if (!withNeighborhood.customerNotes)
    return askStep(
      tx,
      conversation,
      recipient,
      "PROPERTY_CHARACTERISTICS",
      withPrefix(SERVICE_DETAILS_PROMPT, options.prefix)
    );
  return askStep(
    tx,
    conversation,
    recipient,
    "FINAL_CONFIRMATION",
    withPrefix(customerBookingSummary(withNeighborhood), options.prefix)
  );
}

/** Creates the request the conversation fills in, then asks its first step. */
async function startBookingSteps(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  customerId: string,
  recipient: string,
  options: { prefix?: string } = {}
) {
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
        version: { increment: 1 },
      },
    });
    await enqueueManualReviewNotice(tx, updated, recipient);
    return {
      advanced: false as const,
      reason: "SERVICE_NOT_CONFIGURED" as const,
    };
  }
  const booking = await tx.booking.create({
    data: { customerId, serviceId: service.id, requestedAt: new Date() },
  });
  const collecting = await transitionBookingStatusInTransaction(tx, {
    bookingId: booking.id,
    targetStatus: "COLLECTING_DATA",
    actor: "system:customer-conversation",
  });
  if (!collecting.ok) throw collecting.error;
  const linked = await tx.customerBookingConversation.update({
    where: { id: conversation.id },
    data: { bookingId: booking.id },
  });
  return advanceToNextStep(tx, linked, recipient, booking.id, options);
}

/** A request being edited goes back to COLLECTING_DATA while it has not reached matching. */
async function reopenBookingForEdit(
  tx: Prisma.TransactionClient,
  bookingId: string,
  reason: string
): Promise<void> {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  if (
    !["QUOTED", "QUOTE_ACCEPTED", "AWAITING_CUSTOMER_CONFIRMATION"].includes(
      booking.status
    )
  )
    return;
  const collecting = await transitionBookingStatusInTransaction(tx, {
    bookingId,
    targetStatus: "COLLECTING_DATA",
    actor: "customer:whatsapp",
    reason,
  });
  if (!collecting.ok) throw collecting.error;
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
  neighborhood: string
) {
  const actor = "system:customer-conversation";
  // Bring bookings that are still collecting data to the state matching expects.
  if (booking.status === "COLLECTING_DATA" || booking.status === "QUOTED") {
    const confirmed = await transitionBookingStatusInTransaction(tx, {
      bookingId: booking.id,
      targetStatus: "AWAITING_CUSTOMER_CONFIRMATION",
      actor,
      reason: "Cliente confirmou o pedido; segue direto para as profissionais",
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
          "Pronto! Enviamos o seu pedido para as profissionais disponíveis:",
          "",
          ...customerBookingDetails(prepared),
          "",
          "Assim que uma delas aceitar, você recebe aqui o nome e o WhatsApp dela para combinarem direto os detalhes e o valor.",
          "A AllSet apenas conecta vocês; não há cobrança pela plataforma.",
        ].join("\n")
      ),
      idempotencyKey: `customer-booking:${updated.id}:matching-requested:${updated.updatedAt.getTime()}`,
      correlationId: updated.id,
      actor,
    });
  }
  return {
    advanced: true as const,
    state: "COMPLETED" as const,
    bookingId: booking.id,
    dispatched: result.dispatched,
    reason: undefined,
  };
}

/** Final "Confirmar e enviar": re-checks the request before it goes out. */
async function confirmBooking(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  bookingId: string
) {
  const booking = await tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
  });
  // A conversa pode ter ficado parada: nunca envie um horário que já passou.
  if (booking.scheduledAt && booking.scheduledAt <= new Date()) {
    await tx.booking.update({
      where: { id: booking.id },
      data: { scheduledAt: null },
    });
    return advanceToNextStep(tx, conversation, recipient, booking.id, {
      prefix: "O horário escolhido já passou.",
    });
  }
  const neighborhood =
    booking.neighborhood ??
    (booking.addressLine1
      ? extractNeighborhood(booking.addressLine1)
      : undefined);
  if (
    !booking.scheduledAt ||
    !booking.addressLine1 ||
    !neighborhood ||
    !booking.customerNotes
  )
    return advanceToNextStep(tx, conversation, recipient, booking.id);
  return sendBookingToMatching(
    tx,
    conversation,
    recipient,
    booking,
    neighborhood
  );
}

/**
 * Stores a day/time the customer asked for. Anything in the past or invalid
 * is asked again; otherwise the flow moves on to what is still missing.
 */
async function proposeSchedule(
  tx: Prisma.TransactionClient,
  conversation: CustomerBookingConversation,
  recipient: string,
  date: string,
  time: string
) {
  const scheduledAt = scheduledAtFromFortalezaLocal(date, time);
  if (!scheduledAt || scheduledAt <= new Date() || !conversation.bookingId) {
    return recordInvalidAnswer(
      tx,
      conversation,
      recipient,
      "SCHEDULE_DATE",
      (updated) =>
        enqueueQuestion(
          tx,
          updated,
          recipient,
          "SCHEDULE_DATE",
          scheduleDateText("Esse dia e horário já passaram ou são inválidos.")
        ),
      {
        pendingScheduleDate: null,
        state: "SCHEDULE_DATE",
        lastQuestionKey: "SCHEDULE_DATE",
      }
    );
  }
  await tx.booking.update({
    where: { id: conversation.bookingId },
    data: { scheduledAt },
  });
  return advanceToNextStep(
    tx,
    conversation,
    recipient,
    conversation.bookingId,
    {
      prefix: `Anotado: ${formatScheduleForCustomer(scheduledAt)}.`,
    }
  );
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
  return prisma
    .$transaction(async (tx) => {
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
      const needsBooking = [
        "PROPERTY_CHARACTERISTICS",
        "SCHEDULE_DATE",
        "SCHEDULE_TIME",
        "ADDRESS",
        "NEIGHBORHOOD",
        "FINAL_CONFIRMATION",
        "EDIT_SELECTION",
      ].includes(target);
      if (needsBooking && !booking)
        return err(
          "Esta etapa exige um pedido. Retome pela etapa NAME ou reinicie a conversa."
        );
      if (target === "SCHEDULE_TIME" && !current.pendingScheduleDate)
        return err("Escolha primeiro uma data na etapa SCHEDULE_DATE.");
      if (
        ["FINAL_CONFIRMATION", "EDIT_SELECTION"].includes(target) &&
        !booking?.scheduledAt
      )
        return err("Esta etapa exige dia e horário definidos.");
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
      else if (
        booking &&
        !["pause", "close", "restart"].includes(input.action)
      ) {
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
      const conversation =
        await tx.customerBookingConversation.findUniqueOrThrow({
          where: { id: current.id },
        });
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
    })
    .catch((error: unknown) => {
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
        // O telefone identifica o cliente até ele informar o nome.
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
    if (active) return { started: true as const, conversation: active };

    // A customer who still has no real name was never asked for one.
    const needsName = customer.fullName === input.phoneE164;
    const conversation = await tx.customerBookingConversation.create({
      data: {
        customerId: customer.id,
        provider: input.provider,
        state: needsName ? "NAME" : "SCHEDULE_DATE",
        lastQuestionKey: needsName ? "NAME" : "SCHEDULE_DATE",
        lastInboundAt: new Date(),
      },
    });
    if (needsName) {
      await enqueueQuestion(tx, conversation, customer.phoneE164, "NAME");
      return { started: true as const, conversation };
    }
    const result = await startBookingSteps(
      tx,
      conversation,
      customer.id,
      customer.phoneE164,
      {
        prefix: `Olá, ${firstName(customer.fullName)}! Vamos montar seu pedido.`,
      }
    );
    return {
      started: true as const,
      conversation,
      ...(result.reason === "SERVICE_NOT_CONFIGURED"
        ? { reason: "SERVICE_NOT_CONFIGURED" as const }
        : {}),
    };
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
      // Um "obrigado" depois de enviar o pedido não deve abrir outro pedido:
      // responde com a situação atual e só recomeça quando o cliente pedir.
      if (
        latest?.state === "COMPLETED" &&
        latest.bookingId &&
        !NEW_REQUEST_COMMANDS.includes(normalizedText)
      ) {
        const sent = await tx.booking.findUnique({
          where: { id: latest.bookingId },
          include: {
            assignedProfessionalLead: {
              select: { fullName: true, phoneE164: true },
            },
          },
        });
        if (
          sent?.scheduledAt &&
          sent.scheduledAt.getTime() > Date.now() - 24 * 60 * 60 * 1000 &&
          IN_PROGRESS_BOOKING_STATUSES.includes(sent.status)
        ) {
          const claimed = await tx.inboundMessage.updateMany({
            where: { id: inbound.id, processedAt: null },
            data: { processedAt: new Date() },
          });
          if (!claimed.count)
            return { advanced: false, reason: "DUPLICATE_INBOUND" as const };
          await enqueueOutboundMessage(tx, {
            provider: inbound.provider,
            recipient: customer.phoneE164,
            payload: textPayload(
              customerBookingInProgressText({
                scheduledAt: sent.scheduledAt,
                // AWAITING_CUSTOMER_CONFIRMATION: no eligible professional yet;
                // REVIEW_REQUIRED: the offer expired without acceptance.
                offered: ![
                  "AWAITING_CUSTOMER_CONFIRMATION",
                  "REVIEW_REQUIRED",
                ].includes(sent.status),
                professionalName:
                  sent.assignedProfessionalLead?.fullName ?? null,
                professionalPhoneE164:
                  sent.assignedProfessionalLead?.phoneE164 ?? null,
              })
            ),
            idempotencyKey: `customer-booking:${latest.id}:in-progress:${inbound.id}`,
            correlationId: latest.id,
            actor: "system:customer-conversation",
          });
          return { advanced: false, reason: "BOOKING_IN_PROGRESS" as const };
        }
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

    // Conversas paradas em revisão (fluxo antigo com cobertura, ou serviço não
    // configurado): no próximo contato, retomam pelo que ainda falta.
    if (current === "MANUAL_REVIEW") {
      if (!conversation.bookingId)
        return startBookingSteps(
          tx,
          conversation,
          customer.id,
          customer.phoneE164
        );
      const stuck = await tx.booking.findUnique({
        where: { id: conversation.bookingId },
      });
      if (
        stuck &&
        [
          "COLLECTING_DATA",
          "QUOTED",
          "QUOTE_ACCEPTED",
          "REVIEW_REQUIRED",
          "AWAITING_CUSTOMER_CONFIRMATION",
        ].includes(stuck.status)
      ) {
        return advanceToNextStep(
          tx,
          conversation,
          customer.phoneE164,
          stuck.id
        );
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
    // Pedidos que aguardavam pagamento: a plataforma não cobra mais.
    if (current === "AWAITING_PAYMENT") {
      if (conversation.bookingId) {
        return advanceToNextStep(
          tx,
          conversation,
          customer.phoneE164,
          conversation.bookingId,
          {
            prefix:
              "Não é mais necessário pagamento pela AllSet. Seu pedido vai direto para as profissionais.",
          }
        );
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
      if (customer.fullName === customer.phoneE164) {
        return askStep(
          tx,
          conversation,
          customer.phoneE164,
          "NAME",
          CUSTOMER_QUESTIONS.NAME?.text ?? "Qual é o seu nome?"
        );
      }
      return conversation.bookingId
        ? advanceToNextStep(
            tx,
            conversation,
            customer.phoneE164,
            conversation.bookingId
          )
        : startBookingSteps(tx, conversation, customer.id, customer.phoneE164);
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
      const prefix = `Prazer, ${firstName(name)}!`;
      return conversation.bookingId
        ? advanceToNextStep(
            tx,
            conversation,
            customer.phoneE164,
            conversation.bookingId,
            { prefix }
          )
        : startBookingSteps(tx, conversation, customer.id, customer.phoneE164, {
            prefix,
          });
    }

    // Conversas do fluxo antigo sem pedido criado (paradas na escolha do
    // imóvel) começam o pedido pelo dia e horário.
    if (!conversation.bookingId)
      return startBookingSteps(
        tx,
        conversation,
        customer.id,
        customer.phoneE164
      );

    if (current === "PROPERTY_CHARACTERISTICS") {
      const details = input.text.trim();
      if (details.length < 3 || details.length > 1000) {
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
              "PROPERTY_CHARACTERISTICS",
              SERVICE_DETAILS_PROMPT
            )
        );
      }
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data: { customerNotes: details },
      });
      return advanceToNextStep(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "SCHEDULE_DATE") {
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
      if (understood.status === "date_only") {
        return askStep(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_TIME",
          scheduleTimeText(understood.date),
          { pendingScheduleDate: understood.date }
        );
      }
      const prefix =
        understood.status === "time_unavailable"
          ? unavailableTimeText(understood.hour, understood.minute)
          : understood.status === "time_only"
            ? `Entendi o horário (${understood.time}), mas preciso saber o dia.`
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
      if (!conversation.pendingScheduleDate) {
        return askStep(
          tx,
          conversation,
          customer.phoneE164,
          "SCHEDULE_DATE",
          scheduleDateText()
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

    // Fluxo anterior: confirmação do horário antes do endereço.
    if (current === "QUOTE_ACCEPTANCE") {
      if (parseCustomerChoice("FINAL_CONFIRMATION", input.text) === "CHANGE") {
        await reopenBookingForEdit(
          tx,
          conversation.bookingId,
          "Cliente solicitou alteração de dia ou horário"
        );
        await tx.booking.update({
          where: { id: conversation.bookingId },
          data: { scheduledAt: null },
        });
      }
      return advanceToNextStep(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "ADDRESS") {
      const address = input.text.trim();
      if (address.length < 8 || address.length > 500) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "ADDRESS",
          (updated) =>
            enqueueQuestion(
              tx,
              updated,
              customer.phoneE164,
              "ADDRESS",
              `Não consegui ler o endereço. ${ADDRESS_PROMPT}`
            )
        );
      }
      // O endereço completo só é enviado à profissional que aceitar; as
      // demais veem apenas o bairro.
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data: {
          addressLine1: address,
          neighborhood: extractNeighborhood(address) ?? null,
        },
      });
      return advanceToNextStep(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "NEIGHBORHOOD") {
      const neighborhood = input.text.trim();
      if (neighborhood.length < 2 || neighborhood.length > 120) {
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
      return advanceToNextStep(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "FINAL_CONFIRMATION") {
      const answer = parseCustomerChoice(current, input.text);
      if (answer === "CHANGE") {
        return askStep(
          tx,
          conversation,
          customer.phoneE164,
          "EDIT_SELECTION",
          editSelectionText()
        );
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
      return confirmBooking(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    if (current === "EDIT_SELECTION") {
      const choice = parseCustomerChoice(current, input.text);
      if (!choice) {
        return recordInvalidAnswer(
          tx,
          conversation,
          customer.phoneE164,
          "EDIT_SELECTION",
          (updated) =>
            enqueueQuestion(tx, updated, customer.phoneE164, "EDIT_SELECTION")
        );
      }
      await reopenBookingForEdit(
        tx,
        conversation.bookingId,
        `Cliente solicitou alteração de ${choice.toLowerCase()}`
      );
      await tx.booking.update({
        where: { id: conversation.bookingId },
        data:
          choice === "SCHEDULE"
            ? { scheduledAt: null }
            : choice === "ADDRESS"
              ? { addressLine1: null, neighborhood: null }
              : { customerNotes: null },
      });
      return advanceToNextStep(
        tx,
        conversation,
        customer.phoneE164,
        conversation.bookingId
      );
    }

    return { advanced: false, reason: "CONVERSATION_NOT_ACTIVE" as const };
  });
}
