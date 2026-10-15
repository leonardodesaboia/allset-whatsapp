import type { PrismaClient } from "@prisma/client";
import { ok, err } from "../../domain/shared/result";
import { isCustomerAdminStep } from "../../domain/customer/customer-admin-controls";
import { z } from "zod";
import { textPayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";
import { supersedeCustomerPrompts } from "./supersede-customer-prompts";

const inputSchema = z
  .object({
    bookingId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    text: z.string().trim().min(1).max(2_000),
    actor: z.string().trim().min(1).max(160),
  })
  .refine((input) => Boolean(input.bookingId || input.conversationId), {
    message: "Informe uma conversa ou pedido.",
  });

/** Any manual admin message pauses automatic customer prompts until an explicit resume. */
export async function sendManualCustomerMessage(
  prisma: PrismaClient,
  rawInput: {
    bookingId?: string;
    conversationId?: string;
    text: string;
    actor: string;
    expectedVersion?: number;
  }
) {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success)
    return err("Mensagem inválida (máximo 2000 caracteres).");
  const input = parsed.data;
  return prisma.$transaction(async (tx) => {
    const owner = await tx.customerBookingConversation.findUnique({
      where: input.conversationId
        ? { id: input.conversationId }
        : { bookingId: input.bookingId ?? "" },
      select: { customerId: true },
    });
    if (owner)
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.customerId} FOR UPDATE`;
    const conversationWithCustomer = input.conversationId
      ? await tx.customerBookingConversation.findUnique({
          where: { id: input.conversationId },
          include: {
            customer: { select: { phoneE164: true } },
            booking: { select: { id: true } },
          },
        })
      : input.bookingId
        ? await tx.customerBookingConversation.findUnique({
            where: { bookingId: input.bookingId },
            include: {
              customer: { select: { phoneE164: true } },
              booking: { select: { id: true } },
            },
          })
        : null;
    if (!conversationWithCustomer) return err("Conversa não encontrada.");

    if (conversationWithCustomer.state === "COMPLETED")
      return err("Conversa encerrada. Reinicie para enviar mensagens.");
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== conversationWithCustomer.version
    )
      return err("A conversa mudou. Atualize a página e tente novamente.");
    const manualClaimed = await tx.customerBookingConversation.updateMany({
      where: {
        id: conversationWithCustomer.id,
        version: conversationWithCustomer.version,
      },
      data: {
        lastQuestionKey: isCustomerAdminStep(conversationWithCustomer.state)
          ? conversationWithCustomer.state
          : conversationWithCustomer.lastQuestionKey,
        state: "PAUSED",
        automationPausedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (!manualClaimed.count)
      return err("A conversa mudou. Atualize a página e tente novamente.");
    const conversation = await tx.customerBookingConversation.findUniqueOrThrow(
      { where: { id: conversationWithCustomer.id } }
    );
    const superseded = await supersedeCustomerPrompts(tx, conversation.id);
    await enqueueOutboundMessage(tx, {
      provider: conversation.provider,
      recipient: conversationWithCustomer.customer.phoneE164,
      payload: textPayload(input.text),
      idempotencyKey: `customer-booking:${conversation.id}:manual:v${conversation.version}`,
      correlationId: conversation.id,
      actor: input.actor,
    });
    await recordAuditLog(tx, {
      actor: input.actor,
      action: "CUSTOMER_CONVERSATION_PAUSED_BY_MANUAL_MESSAGE",
      entityType: "CustomerBookingConversation",
      entityId: conversation.id,
      metadata: {
        fromState: conversationWithCustomer.state,
        toState: "PAUSED",
        version: conversation.version,
        supersededPrompts: superseded.count,
        reason: "Admin enviou mensagem manual",
        bookingId:
          conversationWithCustomer.booking?.id ?? input.bookingId ?? null,
      },
    });
    return ok({ conversationId: conversation.id });
  });
}
