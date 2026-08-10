import type { ContactIntentConversation, Prisma, PrismaClient } from "@prisma/client";
import { contactIntentPrompt, parseContactIntent, type ContactIntent } from "../../domain/customer/contact-intent";
import { textPayload } from "../../domain/messaging/message";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

async function enqueueIntentPrompt(
  tx: Prisma.TransactionClient,
  conversation: ContactIntentConversation,
): Promise<void> {
  await enqueueOutboundMessage(tx, {
    provider: conversation.provider,
    recipient: conversation.phoneE164,
    payload: textPayload(contactIntentPrompt),
    idempotencyKey: `contact-intent:${conversation.id}:${conversation.updatedAt.getTime()}`,
    correlationId: conversation.id,
    actor: "system:contact-intent",
  });
}

/** Starts a neutral menu. It must run before either customer or recruitment automation. */
export async function startContactIntentConversation(
  prisma: PrismaClient,
  input: { phoneE164: string; provider: string; inboundMessageId?: string },
) {
  return prisma.$transaction(async (tx) => {
    if (input.inboundMessageId) {
      await tx.inboundMessage.updateMany({
        where: { id: input.inboundMessageId, processedAt: null },
        data: { processedAt: new Date() },
      });
    }
    const conversation = await tx.contactIntentConversation.upsert({
      where: { phoneE164: input.phoneE164 },
      create: { phoneE164: input.phoneE164, provider: input.provider, lastInboundAt: new Date() },
      update: { lastInboundAt: new Date() },
    });

    if (conversation.state === "CHOOSING_INTENT") await enqueueIntentPrompt(tx, conversation);
    return conversation;
  });
}

export async function processContactIntentSelection(
  prisma: PrismaClient,
  input: { inboundMessageId: string; text: string },
): Promise<{ handled: boolean; intent?: ContactIntent; reason?: "INBOUND_NOT_FOUND" | "DUPLICATE_INBOUND" | "NO_INTENT_CONVERSATION" | "INVALID_SELECTION" }> {
  return prisma.$transaction(async (tx) => {
    const inbound = await tx.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
    if (!inbound) return { handled: false, reason: "INBOUND_NOT_FOUND" };

    const conversation = await tx.contactIntentConversation.findUnique({ where: { phoneE164: inbound.sender } });
    if (!conversation || conversation.state !== "CHOOSING_INTENT") {
      return { handled: false, reason: "NO_INTENT_CONVERSATION" };
    }

    const claimed = await tx.inboundMessage.updateMany({
      where: { id: inbound.id, processedAt: null },
      data: { processedAt: new Date() },
    });
    if (!claimed.count) return { handled: false, reason: "DUPLICATE_INBOUND" };

    const intent = parseContactIntent(input.text);
    if (!intent) {
      const updated = await tx.contactIntentConversation.update({
        where: { id: conversation.id },
        data: { lastInboundAt: new Date() },
      });
      await enqueueIntentPrompt(tx, updated);
      return { handled: true, reason: "INVALID_SELECTION" };
    }

    await tx.contactIntentConversation.update({
      where: { id: conversation.id },
      data: { state: intent, lastInboundAt: new Date() },
    });
    return { handled: true, intent };
  });
}
