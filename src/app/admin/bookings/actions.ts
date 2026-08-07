"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notifyOpportunity } from "@/application/marketplace/notify-opportunity.usecase";
import { validateCustomerBookingCoverage } from "@/application/customer/validate-booking-coverage.usecase";
import { sendManualCustomerMessage } from "@/application/customer/send-manual-customer-message.usecase";
import { resumeCustomerBookingConversation } from "@/application/customer/customer-booking-conversation.usecase";
import { recordAuditLog } from "@/application/audit/record-audit-log.usecase";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";

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
  return error instanceof Error ? error.message : fallback;
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
  try {
    const result = await sendManualCustomerMessage(prisma, { bookingId, text, actor });
    if (!result.ok) return { ok: false, error: "Este pedido não possui conversa ativa com o cliente." };
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
  try {
    const result = await sendManualCustomerMessage(prisma, { conversationId, text, actor });
    if (!result.ok) return { ok: false, error: "Conversa não encontrada." };
    revalidatePath("/admin/customer-conversations");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível enviar a mensagem.") };
  }
}

export async function resumeCustomerAutomationAction(bookingId: string): Promise<BookingActionResult> {
  const actor = await currentActor();
  if (!actor) return { ok: false, error: "Sessão expirada ou sem permissão." };
  try {
    const result = await resumeCustomerBookingConversation(prisma, { bookingId, actor });
    if (!result.ok) return { ok: false, error: "Esta conversa não pode ser retomada automaticamente." };
    revalidatePath("/admin/bookings");
    return { ok: true, bookingId };
  } catch (error) {
    return { ok: false, error: errorMessage(error, "Não foi possível retomar a automação.") };
  }
}
