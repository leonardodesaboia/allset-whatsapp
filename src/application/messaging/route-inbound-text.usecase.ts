import type { PrismaClient } from "@prisma/client";
import { processOpportunityResponse, requestOpportunityClarification } from "../marketplace/process-opportunity-response.usecase";
import { deliveredResponseIds } from "../marketplace/offer-delivery-state";
import { parseOpportunityReply } from "../../domain/marketplace/opportunity-reply";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";
import type { OperationalLogger } from "../../domain/ports/operational-logger";

/** Um SIM atrasado ainda recebe "prazo encerrado" em vez de cair no menu. */
const lateReplyWindowMs = 24 * 60 * 60 * 1000;

/**
 * Routes all canonical text, including transcriptions. Opportunity replies must
 * take precedence over the recruitment conversation regardless of transport.
 * Each professional has at most one delivered open offer, so a plain SIM/NÃO
 * (or 1/2) is unambiguous. Offers still waiting in the queue never count.
 */
export async function routeInboundText(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string; provider: string },
  logger?: OperationalLogger,
) {
  const reply = parseOpportunityReply(input.text);
  // A pending offer must not swallow commands such as AJUDA or PARAR.
  if (reply) {
    const routed = await routeOpportunityReply(prisma, input, reply.responseToken);
    if (routed) return routed;
  }
  const result = await processContactConversationText(prisma, input);
  if (result.routed === "customer") {
    const reason = "started" in result ? result.started.reason : result.result.reason;
    if (reason === "SERVICE_NOT_CONFIGURED") {
      logger?.error({ reason, provider: input.provider, inboundMessageId: input.inboundMessageId }, "Customer flow blocked: no active service configured");
    }
  }
  return result;
}

async function routeOpportunityReply(
  prisma: PrismaClient,
  input: { inboundMessageId: string; phoneE164: string; text: string },
  responseToken: string | null,
) {
  const now = new Date();
  const subscribed = {
    phoneE164: input.phoneE164,
    proposalsAcceptedAt: { not: null },
    status: { in: ["ATIVA", "PREFERENCIAL"] as Array<"ATIVA" | "PREFERENCIAL"> },
  };
  const open = await prisma.opportunityResponse.findMany({
    where: {
      lead: subscribed,
      response: null,
      opportunity: { status: "OPEN", expiresAt: { gt: now } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { sentAt: "asc" },
    select: { id: true, opportunityId: true, leadId: true, expiresAt: true, responseToken: true },
  });
  const delivered = await deliveredResponseIds(prisma, open);
  const pendingResponses = open.filter((response) => delivered.has(response.id));

  const route = async (responseId: string) => ({
    routed: "opportunity" as const,
    result: await processOpportunityResponse(prisma, {
      responseId,
      text: input.text,
      inboundMessageId: input.inboundMessageId,
    }),
  });

  // Códigos só existem em propostas antigas; continuam aceitos por compatibilidade.
  if (responseToken) {
    const byToken = pendingResponses.find((response) => response.responseToken === responseToken)
      ?? await prisma.opportunityResponse.findFirst({
        where: { lead: { phoneE164: input.phoneE164 }, responseToken },
        select: { id: true },
      });
    if (byToken) return route(byToken.id);
  }
  if (pendingResponses.length === 1) return route(pendingResponses[0]!.id);
  if (pendingResponses.length > 1) {
    // Só acontece com propostas enviadas antes do envio de uma por vez.
    return {
      routed: "opportunity" as const,
      result: await requestOpportunityClarification(prisma, {
        inboundMessageId: input.inboundMessageId,
        responseTokens: pendingResponses.map((response) => response.responseToken),
      }),
    };
  }

  const recent = await prisma.opportunityResponse.findFirst({
    where: {
      lead: subscribed,
      expiresAt: { gt: new Date(now.getTime() - lateReplyWindowMs) },
    },
    orderBy: { expiresAt: "desc" },
    select: { id: true },
  });
  return recent ? route(recent.id) : null;
}
