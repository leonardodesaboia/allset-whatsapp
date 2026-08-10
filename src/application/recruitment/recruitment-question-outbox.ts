import type { Prisma, RecruitmentConversation } from "@prisma/client";
import { audioPayload, textPayload } from "../../domain/messaging/message";
import { QUESTIONS, type ConversationState } from "../../domain/recruitment/conversation-definition";
import { enqueueOutboundMessage } from "../messaging/enqueue-outbound-message.usecase";

export async function enqueueRecruitmentQuestion(
  tx: Prisma.TransactionClient,
  input: {
    conversation: RecruitmentConversation;
    recipient: string;
    state: ConversationState;
    idempotencyPrefix: string;
    text?: string;
    actor: string;
  },
) {
  const question = QUESTIONS[input.state];
  if (!question) return;
  await enqueueOutboundMessage(tx, {
    provider: input.conversation.provider,
    recipient: input.recipient,
    payload: textPayload(input.text ?? question.text),
    idempotencyKey: `${input.idempotencyPrefix}:text`,
    correlationId: input.conversation.id,
    actor: input.actor,
  });
  const audio = await tx.questionAudioAsset.findFirst({
    where: { questionKey: input.state, isActive: true },
    orderBy: { version: "desc" },
  });
  if (audio) {
    await enqueueOutboundMessage(tx, {
      provider: input.conversation.provider,
      recipient: input.recipient,
      payload: audioPayload(audio),
      idempotencyKey: `${input.idempotencyPrefix}:audio:${audio.id}`,
      correlationId: input.conversation.id,
      actor: input.actor,
    });
  }
}
