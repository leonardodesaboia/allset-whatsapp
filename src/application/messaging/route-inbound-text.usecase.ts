import type { PrismaClient } from "@prisma/client";
import { processOpportunityResponse, requestOpportunityClarification } from "../marketplace/process-opportunity-response.usecase";
import { parseOpportunityReply } from "../../domain/marketplace/opportunity-reply";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";
import type { OperationalLogger } from "../../domain/ports/operational-logger";

/**
 * Routes all canonical text, including transcriptions. Opportunity replies must
 * take precedence over the recruitment conversation regardless of transport.
 */
export async function routeInboundText(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string; provider: string },
  logger?: OperationalLogger,
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
  // A pending offer must not swallow commands such as AJUDA or PARAR.
  const pendingResponse = reply?.responseToken
    ? pendingResponses.find((response) => response.responseToken === reply.responseToken)
    : reply && pendingResponses.length === 1 ? pendingResponses[0] : undefined;

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
  if (reply && pendingResponses.length > 0) {
    return {
      routed: "opportunity" as const,
      result: await requestOpportunityClarification(prisma, {
        inboundMessageId: input.inboundMessageId,
        responseTokens: pendingResponses.map((response) => response.responseToken),
      }),
    };
  }
  const result = await processContactConversationText(prisma, input);
  if (result.routed === "customer") {
    const reason = "started" in result ? result.started.reason : result.result.reason;
    if (reason === "PRICING_NOT_CONFIGURED" || reason === "SERVICE_NOT_CONFIGURED") {
      logger?.error({ reason, provider: input.provider, inboundMessageId: input.inboundMessageId }, "Customer flow blocked: no active pricing tiers/service configured");
    }
  }
  return result;
}
