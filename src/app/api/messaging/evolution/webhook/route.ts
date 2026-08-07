import { env } from "@/env";
import { processOpportunityResponse, requestOpportunityClarification } from "@/application/marketplace/process-opportunity-response.usecase";
import { processContactConversationText } from "@/application/messaging/process-contact-conversation-text.usecase";
import { processInboundEvent } from "@/application/messaging/process-inbound-event.usecase";
import { parseOpportunityReply } from "@/domain/marketplace/opportunity-reply";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { isValidEvolutionWebhook, normalizeEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";

export const runtime = "nodejs";

/** A configuração da Evolution deve enviar este valor em `x-allset-webhook-secret`. */
export async function POST(request: Request) {
  if (!isValidEvolutionWebhook(env.EVOLUTION_WEBHOOK_SECRET, request.headers.get("x-allset-webhook-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const event = normalizeEvolutionWebhook(body);
  if (!event) return Response.json({ ok: true, ignored: true });

  try {
    const received = await processInboundEvent(prisma, { ...event, provider: "evolution", actor: "evolution:webhook" });
    if (received.duplicate) return Response.json({ ok: true, duplicate: true });
    if (event.payload.type === "AUDIO") {
      // A mídia será baixada por um job específico antes de o operador classificá-la.
      return Response.json({ ok: true, needsMediaDownload: true }, { status: 202 });
    }

    // Opportunity responses take precedence over recruitment. This is an
    // adapter concern only: the use case validates ownership and claims the
    // inbound message before performing the state transition.
    const pendingOpportunityResponses = await prisma.opportunityResponse.findMany({
      where: {
        lead: { phoneE164: event.sender },
        response: null,
        opportunity: { status: "OPEN" },
      },
      orderBy: { sentAt: "asc" },
      select: { id: true, responseToken: true },
    });
    const reply = parseOpportunityReply(event.payload.text);
    const pendingOpportunityResponse = reply?.responseToken
      ? pendingOpportunityResponses.find((response) => response.responseToken === reply.responseToken)
      : pendingOpportunityResponses.length === 1 ? pendingOpportunityResponses[0] : undefined;
    if (pendingOpportunityResponse) {
      const result = await processOpportunityResponse(prisma, {
        responseId: pendingOpportunityResponse.id,
        text: event.payload.text,
        inboundMessageId: received.message.id,
      });
      return Response.json({ ok: true, routed: "opportunity", result });
    }
    if (pendingOpportunityResponses.length > 0) {
      const result = await requestOpportunityClarification(prisma, {
        inboundMessageId: received.message.id,
        responseTokens: pendingOpportunityResponses.map((response) => response.responseToken),
      });
      return Response.json({ ok: true, routed: "opportunity", result });
    }

    const result = await processContactConversationText(prisma, {
      inboundMessageId: received.message.id,
      phoneE164: event.sender,
      text: event.payload.text,
      provider: "evolution",
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error, provider: "evolution", externalId: event.externalId }, "Falha ao processar webhook da Evolution");
    return Response.json({ ok: false, error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
