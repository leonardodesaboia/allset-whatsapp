import type { PrismaClient } from "@prisma/client";
import { processOpportunityResponse, requestOpportunityClarification } from "../marketplace/process-opportunity-response.usecase";
import { parseOpportunityReply } from "../../domain/marketplace/opportunity-reply";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";

/**
 * Routes all canonical text, including transcriptions. Opportunity replies must
 * take precedence over the recruitment conversation regardless of transport.
 */
export async function routeInboundText(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string; provider: string },
) {
  const pendingResponses = await prisma.opportunityResponse.findMany({
    where: {
      lead: { phoneE164: input.phoneE164 },
      response: null,
      opportunity: { status: "OPEN" },
    },
    orderBy: { sentAt: "asc" },
    select: { id: true, responseToken: true },
  });
  const reply = parseOpportunityReply(input.text);
  const pendingResponse = reply?.responseToken
    ? pendingResponses.find((response) => response.responseToken === reply.responseToken)
    : pendingResponses.length === 1 ? pendingResponses[0] : undefined;

  if (pendingResponse) {
    return {
      routed: "opportunity" as const,
      result: await processOpportunityResponse(prisma, {
        responseId: pendingResponse.id,
        text: input.text,
        inboundMessageId: input.inboundMessageId,
      }),
    };
  }
  if (pendingResponses.length > 0) {
    return {
      routed: "opportunity" as const,
      result: await requestOpportunityClarification(prisma, {
        inboundMessageId: input.inboundMessageId,
        responseTokens: pendingResponses.map((response) => response.responseToken),
      }),
    };
  }
  return processContactConversationText(prisma, input);
}
