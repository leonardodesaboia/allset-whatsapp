import { env } from "@/env";
import { processInboundEvent } from "@/application/messaging/process-inbound-event.usecase";
import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { routeInboundText } from "@/application/messaging/route-inbound-text.usecase";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { isValidEvolutionWebhook, normalizeEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import { PayloadTooLargeError, parseJsonBody } from "@/infrastructure/http/parse-json-body";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 1_048_576;

/** A configuração da Evolution deve enviar este valor em `x-allset-webhook-secret`. */
export async function POST(request: Request) {
  if (!isValidEvolutionWebhook(env.EVOLUTION_WEBHOOK_SECRET, request.headers.get("x-allset-webhook-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const event = normalizeEvolutionWebhook(body);
  if (!event) return Response.json({ ok: true, ignored: true });

  try {
    const received = await processInboundEvent(prisma, { ...event, provider: "evolution", actor: "evolution:webhook" });
    if (received.duplicate && received.message.processedAt) return Response.json({ ok: true, duplicate: true });
    if (event.payload.type === "AUDIO") {
      // A mídia será baixada por um job específico antes de o operador classificá-la.
      return Response.json({ ok: true, needsMediaDownload: true }, { status: 202 });
    }

    const result = await routeInboundText(prisma, {
      inboundMessageId: received.message.id,
      phoneE164: event.sender,
      text: event.payload.text,
      provider: "evolution",
    });
    dispatchNextOutboxMessage(prisma, createMessagingGatewayRegistry(), "system:webhook-dispatch").catch(
      (err) => logger.error({ err }, "Falha ao despachar outbox inline no webhook"),
    );
    return Response.json({ ok: true, ...(received.duplicate ? { recovered: true } : {}), ...result });
  } catch (error) {
    logger.error({ err: error, provider: "evolution", externalId: event.externalId }, "Falha ao processar webhook da Evolution");
    return Response.json({ ok: false, error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
