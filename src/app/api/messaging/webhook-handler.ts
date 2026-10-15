import { env } from "@/env";
import { processInboundEvent } from "@/application/messaging/process-inbound-event.usecase";
import { drainOutbox } from "@/infrastructure/messaging/drain-outbox";
import { routeInboundText } from "@/application/messaging/route-inbound-text.usecase";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import type { normalizeEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { processRuntimeReceivedAudio } from "@/infrastructure/messaging/received-audio-runtime";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import {
  PayloadTooLargeError,
  parseJsonBody,
} from "@/infrastructure/http/parse-json-body";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";
import { activeStates as customerActiveStates } from "@/application/customer/reengage-silent-customer-conversations.usecase";

const MAX_WEBHOOK_BYTES = 1_048_576;

export async function handleMessagingWebhook(request: Request, config: { provider: string; secret: string | undefined; normalize: typeof normalizeEvolutionWebhook }) {
  if (
    !compareSecret(
      config.secret,
      request.headers.get("x-allset-webhook-secret")
    )
  ) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json(
      { ok: false, error: "PAYLOAD_TOO_LARGE" },
      { status: 413 }
    );
  }

  let body: unknown;
  try {
    body = await parseJsonBody(request, MAX_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json(
        { ok: false, error: "PAYLOAD_TOO_LARGE" },
        { status: 413 }
      );
    }
    return Response.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const event = config.normalize(
    body,
    env.WHATSAPP_NUMBER ? `+${env.WHATSAPP_NUMBER}` : "allset"
  );
  if (!event) return Response.json({ ok: true, ignored: true });

  try {
    const received = await processInboundEvent(prisma, {
      ...event,
      provider: config.provider,
      actor: `${config.provider}:webhook`,
    });
    if (received.duplicate && received.message.processedAt)
      return Response.json({ ok: true, duplicate: true });
    if (event.payload.type === "AUDIO") {
      // Worker downloads, transcribes and routes. Fallback: cron/download-audio.
      publishJobSafe({
        name: JOB_NAME.RECEIVED_AUDIO,
        jobId: `received-audio:${received.message.id}`,
        payload: { inboundMessageId: received.message.id },
      }).catch((err) =>
        logger.error({ err }, "Falha ao publicar job de áudio")
      );
      if (config.provider === "whatsmiau" && !process.env.REDIS_URL) {
        // Public URLs have an undocumented lifetime. Without BullMQ, start immediately.
        void processRuntimeReceivedAudio(prisma, { inboundMessageId: received.message.id, limit: 1 }).then(
          (results) => { if (results.some((result) => !result.ok)) logger.error({ results }, "Inline audio processing failed"); },
          (err) => logger.error({ err }, "Inline audio failed; cron will retry"),
        );
      }
      return Response.json(
        { ok: true, needsMediaDownload: true },
        { status: 202 }
      );
    }

    const result = await routeInboundText(prisma, {
      inboundMessageId: received.message.id,
      phoneE164: event.sender,
      text: event.payload.text,
      provider: config.provider,
    });
    // Schedule a delayed reengagement check whenever a recruitment message is processed.
    // Stable jobId = at most one pending check per conversation (BullMQ dedup).
    // The processor re-verifies lastInboundAt before sending, so a late message is safe.
    if (result.routed === "recruitment") {
      prisma.recruitmentConversation
        .findFirst({
          where: { lead: { phoneE164: event.sender } },
          select: {
            id: true,
            reengagementCount: true,
            state: true,
            lastInboundAt: true,
          },
        })
        .then((conv) => {
          if (
            !conv ||
            conv.state === "COMPLETED" ||
            conv.state === "PAUSED" ||
            conv.state === "MANUAL_REVIEW" ||
            conv.state === "INTRODUCTION"
          )
            return;
          return publishJobSafe({
            name: JOB_NAME.RECRUITMENT_REENGAGEMENT,
            jobId: `reengagement:${conv.id}:${conv.lastInboundAt?.getTime()}:${conv.reengagementCount}`,
            payload: {
              conversationId: conv.id,
              reengagementCount: conv.reengagementCount,
            },
            delay: env.RECRUITMENT_REENGAGEMENT_AFTER_HOURS * 60 * 60 * 1000,
          });
        })
        .catch((err) =>
          logger.error({ err }, "Falha ao agendar job de reengajamento")
        );
    }
    // Same idea for a customer booking conversation: delayed check, dedup by
    // (conversationId, lastInboundAt) so a late message is still safe.
    if (result.routed === "customer") {
      prisma.customerBookingConversation
        .findFirst({
          where: { customer: { phoneE164: event.sender } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, state: true, lastInboundAt: true },
        })
        .then((conv) => {
          if (
            !conv?.lastInboundAt ||
            !(customerActiveStates as readonly string[]).includes(conv.state)
          )
            return;
          return publishJobSafe({
            name: JOB_NAME.CUSTOMER_REENGAGEMENT,
            jobId: `customer-reengagement:${conv.id}:${conv.lastInboundAt.getTime()}`,
            payload: {
              conversationId: conv.id,
              lastInboundAtMs: conv.lastInboundAt.getTime(),
            },
            delay: env.CUSTOMER_REENGAGEMENT_AFTER_HOURS * 60 * 60 * 1000,
          });
        })
        .catch((err) =>
          logger.error(
            { err },
            "Falha ao agendar job de reengajamento do cliente"
          )
        );
    }
    // Publish a drain trigger. Fallback: worker picks up any remaining pending messages.
    // If REDIS_URL is not set, dispatch inline (keeps existing behavior).
    if (process.env.REDIS_URL) {
      publishJobSafe({
        name: JOB_NAME.MESSAGE_DISPATCH,
        jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
        payload: {},
      }).catch((err) =>
        logger.error({ err }, "Falha ao publicar job de dispatch")
      );
    } else {
      drainOutbox(
        prisma,
        createMessagingGatewayRegistry(),
        { actor: "system:webhook-dispatch", limit: 20 }
      ).catch((err) =>
        logger.error({ err }, "Falha ao despachar outbox inline no webhook")
      );
    }
    return Response.json({
      ok: true,
      ...(received.duplicate ? { recovered: true } : {}),
      ...result,
    });
  } catch (error) {
    logger.error(
      { err: error, provider: config.provider, externalId: event.externalId },
      "Messaging webhook processing failed"
    );
    return Response.json(
      { ok: false, error: "PROCESSING_FAILED" },
      { status: 500 }
    );
  }
}
