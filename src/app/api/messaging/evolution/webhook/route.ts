import { env } from "@/env";
import { processOpportunityResponse } from "@/application/marketplace/process-opportunity-response.usecase";
import { processInboundEvent } from "@/application/messaging/process-inbound-event.usecase";
import { processRecruitmentAnswer, startRecruitmentConversation } from "@/application/recruitment/conversation-engine.usecase";
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
    const pendingOpportunityResponse = await prisma.opportunityResponse.findFirst({
      where: {
        lead: { phoneE164: event.sender },
        response: null,
        opportunity: { status: "OPEN" },
      },
      orderBy: { sentAt: "asc" },
    });
    if (pendingOpportunityResponse) {
      const result = await processOpportunityResponse(prisma, {
        responseId: pendingOpportunityResponse.id,
        text: event.payload.text,
        inboundMessageId: received.message.id,
      });
      return Response.json({ ok: true, routed: "opportunity", result });
    }

    const lead = await prisma.recruitmentLead.findUnique({
      where: { phoneE164: event.sender },
      include: { conversation: { select: { id: true } } },
    });
    if (!lead) {
      await startRecruitmentConversation(prisma, { phoneE164: event.sender, provider: "evolution" });
      return Response.json({ ok: true, started: true }, { status: 202 });
    }
    if (!lead.conversation) {
      // Lead criado manualmente antes do primeiro contato via WhatsApp:
      // inicia a conversa se ainda estiver no início do funil.
      if (lead.status === "LEAD" || lead.status === "PRE_CADASTRO") {
        await startRecruitmentConversation(prisma, { phoneE164: event.sender, provider: "evolution" });
        return Response.json({ ok: true, started: true }, { status: 202 });
      }
      return Response.json({ ok: true, ignored: "NO_RECRUITMENT_CONVERSATION" });
    }

    const result = await processRecruitmentAnswer(prisma, { inboundMessageId: received.message.id, text: event.payload.text });
    return Response.json({ ok: true, result });
  } catch (error) {
    logger.error({ err: error, provider: "evolution", externalId: event.externalId }, "Falha ao processar webhook da Evolution");
    return Response.json({ ok: false, error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
