import type { PrismaClient } from "@prisma/client";
import { processContactIntentSelection, startContactIntentConversation } from "../customer/contact-intent-conversation.usecase";
import { processCustomerBookingAnswer, startCustomerBookingConversation } from "../customer/customer-booking-conversation.usecase";
import { processRecruitmentAnswer, startRecruitmentConversation } from "../recruitment/conversation-engine.usecase";

/**
 * Routes canonical text (native or transcribed) after opportunity handling.
 * The Evolution adapter deliberately does not know customer/recruitment states.
 */
export async function processContactConversationText(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string; provider: string },
) {
  const lead = await prisma.recruitmentLead.findUnique({
    where: { phoneE164: input.phoneE164 },
    include: { conversation: { select: { id: true } } },
  });
  const contactIntent = await prisma.contactIntentConversation.findUnique({ where: { phoneE164: input.phoneE164 } });

  if (!contactIntent && !lead) {
    await startContactIntentConversation(prisma, {
      phoneE164: input.phoneE164,
      provider: input.provider,
      inboundMessageId: input.inboundMessageId,
    });
    return { routed: "contact-intent" as const, started: true };
  }
  if (contactIntent?.state === "CHOOSING_INTENT") {
    const selection = await processContactIntentSelection(prisma, { inboundMessageId: input.inboundMessageId, text: input.text });
    if (selection.intent === "CUSTOMER") {
      return { routed: "customer" as const, started: await startCustomerBookingConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
    }
    if (selection.intent === "PROFESSIONAL") {
      return { routed: "recruitment" as const, started: await startRecruitmentConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
    }
    return { routed: "contact-intent" as const, selection };
  }
  if (contactIntent?.state === "CUSTOMER") {
    const result = await processCustomerBookingAnswer(prisma, { inboundMessageId: input.inboundMessageId, text: input.text });
    if (result.reason === "CONVERSATION_NOT_ACTIVE") {
      return {
        routed: "customer" as const,
        started: await startCustomerBookingConversation(prisma, {
          phoneE164: input.phoneE164,
          provider: input.provider,
          inboundMessageId: input.inboundMessageId,
        }),
      };
    }
    if (result.reason === "CONVERSATION_PAUSED") {
      return { routed: "paused" as const };
    }
    return { routed: "customer" as const, result };
  }
  if (contactIntent?.state === "PAUSED") return { routed: "paused" as const };

  if (!lead) {
    return { routed: "recruitment" as const, started: await startRecruitmentConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
  }
  if (!lead.conversation) {
    if (lead.status === "LEAD" || lead.status === "PRE_CADASTRO") {
      return { routed: "recruitment" as const, started: await startRecruitmentConversation(prisma, { phoneE164: input.phoneE164, provider: input.provider }) };
    }
    return { routed: "recruitment" as const, ignored: "NO_RECRUITMENT_CONVERSATION" as const };
  }
  return { routed: "recruitment" as const, result: await processRecruitmentAnswer(prisma, { inboundMessageId: input.inboundMessageId, text: input.text }) };
}
