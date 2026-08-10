import type { Prisma } from "@prisma/client";
import { textPayload } from "../../domain/messaging/message";
import { CUSTOMER_QUESTIONS, type CustomerConversationState } from "../../domain/customer/customer-conversation-definition";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

export function customerQuestionText(state: CustomerConversationState): string | null {
  const question = CUSTOMER_QUESTIONS[state];
  if (!question) return null;
  if (!question.choices) return question.text;
  return [question.text, "", ...question.choices.map((choice, index) => `${index + 1} — ${choice.label}`)].join("\n");
}

export async function enqueueCustomerQuestion(tx: Prisma.TransactionClient, input: { conversationId: string; provider: string; recipient: string; state: CustomerConversationState; idempotencyKey: string; text?: string }) {
  const text = input.text ?? customerQuestionText(input.state);
  if (!text) return;
  await enqueueOutboundMessage(tx, {
    provider: input.provider,
    recipient: input.recipient,
    payload: textPayload(text),
    idempotencyKey: input.idempotencyKey,
    correlationId: input.conversationId,
    actor: "system:customer-conversation",
  });
}
