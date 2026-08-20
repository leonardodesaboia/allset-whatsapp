"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notifyOpportunity } from "@/application/marketplace/notify-opportunity.usecase";
import { validateCustomerBookingCoverage } from "@/application/customer/validate-booking-coverage.usecase";
import { sendManualCustomerMessage } from "@/application/customer/send-manual-customer-message.usecase";
import { resumeCustomerBookingConversation } from "@/application/customer/customer-booking-conversation.usecase";
import { recordAuditLog } from "@/application/audit/record-audit-log.usecase";
import { transitionBookingStatusInTransaction } from "@/application/booking/transition-booking-status.usecase";
import { enqueueOutboundMessage } from "@/application/messaging/enqueue-outbound-message.usecase";
import { textPayload } from "@/domain/messaging/message";
import { DomainError } from "@/domain/shared/domain-error";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  neighborhood: z.string().trim().min(2).max(120),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(30).max(12 * 60),
  professionalPaymentCents: z.number().int().positive().max(10_000_000),
  customerName: z.string().trim().min(2).max(160),
  customerPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
});
const bookingIdSchema = z.string().uuid();
const conversationIdSchema = z.string().uuid();

export type BookingActionResult =
  | { ok: true; bookingId?: string; notified?: number }
  | { ok: false; error: string };

async function currentActor(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const email = session?.user.email;
  if (!email) return null;
  const admin = await prisma.user.findFirst({ where: { email, role: "ADMIN" }, select: { email: true } });
  return admin?.email ?? null;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof z.ZodError) return "Revise os dados informados.";
  return error instanceof DomainError ? error.message : fallback;
}

export async function createBookingAction(input: {
  serviceId: string;
  neighborhood: string;
  scheduledDate: string;
  scheduledTime: string;
  durationMinutes: number;
  professionalPaymentCents: number;
  customerName: string;
  customerPhone: string;
}): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };

  try {
    const data = createBookingSchema.parse(input);
    const scheduledAt = new Date(`${data.scheduledDate}T${data.scheduledTime}:00-03:00`);
    if (Number.isNaN(scheduledAt.getTime())) {
      return { ok: false, error: "Data ou horário inválido." };
    }
    if (scheduledAt <= new Date()) {
      return { ok: false, error: "O agendamento precisa estar em uma data e horário futuros." };
    }

    const booking = await prisma.$transaction(async (tx) => {
      const service = await tx.serviceDefinition.findFirst({
        where: { id: data.serviceId, isActive: true },
        select: { id: true },
      });
      if (!service) throw new Error("Serviço não encontrado ou inativo.");

      const existingCustomer = await tx.user.findUnique({ where: { phoneE164: data.customerPhone } });
      if (existingCustomer && existingCustomer.role !== "CUSTOMER") {
        throw new Error("Este telefone já pertence a um usuário que não é cliente.");
      }
      const customer = existingCustomer ?? await tx.user.create({
        data: { role: "CUSTOMER", fullName: data.customerName, phoneE164: data.customerPhone },
      });
      const created = await tx.booking.create({
        data: {
          customerId: customer.id,
          serviceId: service.id,
          status: "DRAFT",
          neighborhood: data.neighborhood,
          scheduledAt,
          durationMinutes: data.durationMinutes,
          professionalPaymentCents: data.professionalPaymentCents,
        },
      });
      await recordAuditLog(tx, {
        actor,
        action: "BOOKING_CREATED",
        entityType: "Booking",
        entityId: created.id,
        metadata: { customerId: customer.id, serviceId: service.id },
      });
      return created;
    });
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId: booking.id };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível criar o agendamento.") };
  }
}

export async function dispatchOpportunityAction(bookingId: string): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!z.string().uuid().safeParse(bookingId).success) {
    return { ok: false, error: "Identificador de agendamento inválido." };
  }

  try {
    const result = await notifyOpportunity(prisma, { bookingId, actor });
    if (!result.dispatched) {
      return { ok: false, error: "Nenhuma profissional elegível está disponível para este agendamento." };
    }

    // Publish delayed expiration job for each newly created open opportunity.
    // Fallback: cron/marketplace/expire runs periodically.
    const openOpportunities = await prisma.serviceOpportunity.findMany({
      where: { bookingId, status: "OPEN" },
      select: { id: true, expiresAt: true },
    });
    for (const opportunity of openOpportunities) {
      const delay = Math.max(0, opportunity.expiresAt.getTime() - Date.now());
      publishJobSafe({
        name: JOB_NAME.OPPORTUNITY_EXPIRATION,
        jobId: `opportunity-expiration:${opportunity.id}`,
        payload: { opportunityId: opportunity.id },
        delay,
      }).catch(() => undefined);
    }

    // Trigger outbox dispatch so opportunity messages go out immediately.
    publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
      payload: {},
    }).catch(() => undefined);

    revalidatePath("/admin/bookings");
    revalidatePath(`/admin/bookings/${bookingId}/opportunity`);
    return { ok: true, notified: result.notified };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível enviar a oportunidade.") };
  }
}

export async function validateBookingCoverageAction(
  bookingId: string,
  isCovered: boolean,
): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!z.string().uuid().safeParse(bookingId).success || typeof isCovered !== "boolean") {
    return { ok: false, error: "Dados de cobertura inválidos." };
  }
  try {
    const result = await validateCustomerBookingCoverage(prisma, { bookingId, isCovered, actor });
    if (!result.ok) return { ok: false, error: "Este pedido não está aguardando validação de cobertura." };
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível validar a cobertura.") };
  }
}

export async function sendManualCustomerMessageAction(
  bookingId: string,
  text: string,
): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!bookingIdSchema.safeParse(bookingId).success || typeof text !== "string") {
    return { ok: false, error: "Dados da mensagem inválidos." };
  }
  try {
    const result = await sendManualCustomerMessage(prisma, { bookingId, text, actor });
    if (!result.ok) return { ok: false, error: "Este pedido não possui conversa ativa com o cliente." };
    publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
      payload: {},
    }).catch(() => undefined);
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível enviar a mensagem.") };
  }
}

export async function sendManualCustomerConversationMessageAction(
  conversationId: string,
  text: string,
): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!conversationIdSchema.safeParse(conversationId).success || typeof text !== "string") {
    return { ok: false, error: "Dados da mensagem inválidos." };
  }
  try {
    const result = await sendManualCustomerMessage(prisma, { conversationId, text, actor });
    if (!result.ok) return { ok: false, error: "Conversa não encontrada." };
    publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
      payload: {},
    }).catch(() => undefined);
    revalidatePath("/admin/customer-conversations");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível enviar a mensagem.") };
  }
}

export async function resumeCustomerAutomationAction(bookingId: string): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!bookingIdSchema.safeParse(bookingId).success) {
    return { ok: false, error: "Identificador de agendamento inválido." };
  }
  try {
    const result = await resumeCustomerBookingConversation(prisma, { bookingId, actor });
    if (!result.ok) return { ok: false, error: "Esta conversa não pode ser retomada automaticamente." };
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível retomar a automação.") };
  }
}

/** Records an off-platform payment until a real PaymentProvider is configured. */
export async function confirmManualPaymentAction(bookingId: string): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  if (!z.string().uuid().safeParse(bookingId).success) return { ok: false, error: "Identificador de agendamento inválido." };
  try {
    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { customer: { select: { phoneE164: true } }, customerConversation: true },
      });
      if (!booking) throw new Error("Agendamento não encontrado.");
      const transition = await transitionBookingStatusInTransaction(tx, {
        bookingId,
        targetStatus: "PAID",
        actor,
        reason: "Pagamento confirmado manualmente",
      });
      if (!transition.ok) throw transition.error;
      if (booking.customerConversation) {
        const conversation = await tx.customerBookingConversation.update({
          where: { id: booking.customerConversation.id },
          data: { state: "COMPLETED", lastInboundAt: new Date() },
        });
        await enqueueOutboundMessage(tx, {
          provider: conversation.provider,
          recipient: booking.customer.phoneE164,
          payload: textPayload("Pagamento confirmado! Agora vamos buscar a profissional ideal para seu atendimento."),
          idempotencyKey: `customer-booking:${conversation.id}:payment-confirmed`,
          correlationId: conversation.id,
          actor,
        });
      }
    });
    publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
      payload: {},
    }).catch(() => undefined);
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível confirmar o pagamento.") };
  }
}
