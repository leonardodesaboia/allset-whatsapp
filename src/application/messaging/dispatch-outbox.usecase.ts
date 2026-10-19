import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MessagingGatewayRegistry } from "../../domain/ports/messaging-gateway";
import type { OutboundMessagePayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { ProviderAuthenticationError } from "../../domain/messaging/provider-authentication-error";
import { env } from "../../env";
import { isRetiredPaymentMessage } from "../../domain/messaging/retired-payment-message";
import { prepareOpportunityDelivery } from "../marketplace/prepare-opportunity-delivery.usecase";
import { isEligibleForOpportunity } from "../../domain/marketplace/opportunity-matching-policy";

const maxAttempts = 8;
// A API pode demorar em redes móveis. Uma lease mais longa reduz a
// reivindicação concorrente durante uma entrega ainda em curso; o protocolo de
// entrega permanece at-least-once; nem todo provider oferece idempotência remota.
const leaseMs = 5 * 60_000;
const retryDelayMs = (attempt: number) =>
  Math.min(3_600_000, 30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
/**
 * Gateways that deliver through the production WhatsApp number. They share one
 * global minimum interval (WHATSAPP_MESSAGE_INTERVAL_SECONDS) across webhooks,
 * workers, crons and replicas; other providers (mock, tests) are not throttled.
 */
const WHATSAPP_PROVIDERS = new Set(["evolution", "whatsmiau"]);
export const WHATSAPP_THROTTLE_KEY = "whatsapp";
const safeError = (error: unknown) =>
  (error instanceof Error
    ? error.message
    : "Falha desconhecida de mensageria"
  ).slice(0, 500);

export async function dispatchNextOutboxMessage(
  prisma: PrismaClient,
  registry: MessagingGatewayRegistry,
  actor = "system:outbox"
) {
  const now = new Date();
  const unavailable = await prisma.messagingProviderState.findMany({
    where: {
      OR: [{ blockedUntil: { gt: now } }, { leaseExpiresAt: { gt: now } }],
    },
    select: { provider: true },
  });
  const excluded = unavailable.flatMap(
    ({ provider }) => registry.aliasesFor?.(provider) ?? [provider]
  );
  const candidate = await prisma.outboxMessage.findFirst({
    where: {
      ...(excluded.length ? { provider: { notIn: excluded } } : {}),
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: now } },
        { status: "SENDING", leaseExpiresAt: { lte: now } },
      ],
    },
    // Respostas e confirmações não esperam atrás de toda a lista de propostas.
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;
  if (isRetiredPaymentMessage(candidate.idempotencyKey)) {
    const cancelled = await prisma.outboxMessage.updateMany({
      where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
      data: { status: "CANCELLED", leaseExpiresAt: null, lastError: "Cobrança pela plataforma desativada" },
    });
    return cancelled.count ? prisma.outboxMessage.findUnique({ where: { id: candidate.id } }) : null;
  }
  if (candidate.idempotencyKey.endsWith(":offer") && candidate.correlationId) {
    // Ofertas encerradas ou para quem retirou o aceite não chegam a gastar envio.
    const [opportunity, lead] = await Promise.all([
      prisma.serviceOpportunity.findUnique({ where: { id: candidate.correlationId }, select: { status: true } }),
      prisma.recruitmentLead.findUnique({ where: { phoneE164: candidate.recipient } }),
    ]);
    if (!opportunity || opportunity.status !== "OPEN" || !lead || !isEligibleForOpportunity(lead)) {
      const cancelled = await prisma.outboxMessage.updateMany({
        where: { id: candidate.id, status: candidate.status, attempts: candidate.attempts },
        data: { status: "CANCELLED", leaseExpiresAt: null, lastError: "Proposta encerrada ou profissional indisponível" },
      });
      return cancelled.count ? prisma.outboxMessage.findUnique({ where: { id: candidate.id } }) : null;
    }
  }
  const attempt = candidate.attempts + 1;
  const leaseExpiresAt = new Date(Date.now() + leaseMs);

  const provider =
    registry.canonicalProvider?.(candidate.provider) ?? candidate.provider;
  const leaseToken = randomUUID();
  // Serialize sends for a gateway so simultaneous actors cannot all discover
  // the same broken credential, even when legacy aliases share that gateway.
  await prisma.messagingProviderState.createMany({
    data: [{ provider }],
    skipDuplicates: true,
  });
  const providerClaim = await prisma.messagingProviderState.updateMany({
    where: {
      provider,
      AND: [
        { OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }] },
        { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
      ],
    },
    data: { leaseExpiresAt, leaseToken },
  });
  if (!providerClaim.count) return null;

  try {
    // The provider lease above serializes this section, so reading and moving
    // the throttle needs no extra lock.
    const throttled =
      env.WHATSAPP_MESSAGE_INTERVAL_SECONDS > 0 && WHATSAPP_PROVIDERS.has(provider);
    if (throttled) {
      await prisma.messagingDispatchThrottle.createMany({
        data: [{ provider: WHATSAPP_THROTTLE_KEY, nextSendAt: now }],
        skipDuplicates: true,
      });
      const throttle = await prisma.messagingDispatchThrottle.findUniqueOrThrow({
        where: { provider: WHATSAPP_THROTTLE_KEY },
      });
      if (throttle.nextSendAt > new Date()) return null;
    }
    const claimed = await prisma.outboxMessage.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        attempts: candidate.attempts,
        ...(candidate.status === "SENDING"
          ? { leaseExpiresAt: { lte: now } }
          : { availableAt: { lte: now } }),
      },
      data: {
        status: "SENDING",
        attempts: { increment: 1 },
        leaseExpiresAt,
      },
    });
    if (!claimed.count) return null;
    // Failures also consume the interval: a retry storm must not burst sends.
    if (throttled)
      await prisma.messagingDispatchThrottle.update({
        where: { provider: WHATSAPP_THROTTLE_KEY },
        data: { nextSendAt: new Date(Date.now() + env.WHATSAPP_MESSAGE_INTERVAL_SECONDS * 1000) },
      });

    const gateway = registry.get(candidate.provider);
    if (!gateway) {
      return await fail(
        prisma,
        candidate.id,
        attempt,
        leaseExpiresAt,
        `Provider não registrado: ${candidate.provider}`,
        actor
      );
    }
    if (candidate.type === "AUDIO" && !gateway.capabilities().audio) {
      return await fail(
        prisma,
        candidate.id,
        attempt,
        leaseExpiresAt,
        "Provider não suporta áudio",
        actor,
        true
      );
    }

    try {
      let payload = candidate.payload as unknown as OutboundMessagePayload;
      if (candidate.idempotencyKey.endsWith(":offer") && candidate.correlationId) {
        // Local público e prazo são definidos no envio, inclusive em retries.
        const prepared = await prepareOpportunityDelivery(prisma, {
          ...candidate,
          status: "SENDING",
          attempts: attempt,
          leaseExpiresAt,
        });
        if (!prepared) return await prisma.outboxMessage.findUnique({ where: { id: candidate.id } });
        payload = prepared;
      }
      const sent = await gateway.send({
        recipient: candidate.recipient,
        payload,
        idempotencyKey: candidate.idempotencyKey,
        ...(candidate.correlationId
          ? { correlationId: candidate.correlationId }
          : {}),
      });
      return await prisma.$transaction(async (tx) => {
        const completed = await tx.outboxMessage.updateMany({
          where: {
            id: candidate.id,
            status: "SENDING",
            attempts: attempt,
            leaseExpiresAt,
          },
          data: {
            status: "SENT",
            sentAt: new Date(),
            externalId: sent.externalId,
            lastError: null,
            leaseExpiresAt: null,
          },
        });
        if (!completed.count) return null;
        await tx.messagingProviderState.updateMany({
          where: { provider, leaseToken },
          data: { blockedUntil: null, lastError: null, httpStatus: null },
        });
        const updated = await tx.outboxMessage.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        await recordAuditLog(tx, {
          actor,
          action: "OUTBOX_MESSAGE_SENT",
          entityType: "OutboxMessage",
          entityId: updated.id,
          metadata: { provider: updated.provider, externalId: sent.externalId },
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof ProviderAuthenticationError) {
        const blockedUntil = new Date(Date.now() + 5 * 60_000);
        return await prisma.$transaction(async (tx) => {
          const restored = await tx.outboxMessage.updateMany({
            where: {
              id: candidate.id,
              status: "SENDING",
              attempts: attempt,
              leaseExpiresAt,
            },
            data: {
              status: "FAILED",
              attempts: candidate.attempts,
              availableAt: blockedUntil,
              leaseExpiresAt: null,
              lastError: safeError(error),
            },
          });
          if (!restored.count) return null;
          await tx.messagingProviderState.updateMany({
            where: { provider, leaseToken },
            data: {
              blockedUntil,
              lastError: safeError(error),
              httpStatus: error.httpStatus,
            },
          });
          await recordAuditLog(tx, {
            actor,
            action: "OUTBOX_PROVIDER_AUTHENTICATION_BLOCKED",
            entityType: "OutboxMessage",
            entityId: candidate.id,
            metadata: {
              provider,
              httpStatus: error.httpStatus,
              blockedUntil: blockedUntil.toISOString(),
            },
          });
          return tx.outboxMessage.findUniqueOrThrow({
            where: { id: candidate.id },
          });
        });
      }
      return await fail(
        prisma,
        candidate.id,
        attempt,
        leaseExpiresAt,
        safeError(error),
        actor
      );
    }
  } finally {
    await prisma.messagingProviderState.updateMany({
      where: { provider, leaseToken },
      data: { leaseExpiresAt: null, leaseToken: null },
    });
  }
}

async function fail(
  prisma: PrismaClient,
  id: string,
  attempts: number,
  leaseExpiresAt: Date,
  error: string,
  actor: string,
  permanent = false
) {
  const deadLetter = permanent || attempts >= maxAttempts;
  return prisma.$transaction(async (tx) => {
    const failed = await tx.outboxMessage.updateMany({
      where: { id, status: "SENDING", attempts, leaseExpiresAt },
      data: {
        status: deadLetter ? "DEAD_LETTER" : "FAILED",
        lastError: error,
        leaseExpiresAt: null,
        ...(deadLetter
          ? {}
          : { availableAt: new Date(Date.now() + retryDelayMs(attempts)) }),
      },
    });
    if (!failed.count) return null;
    const updated = await tx.outboxMessage.findUniqueOrThrow({ where: { id } });
    await recordAuditLog(tx, {
      actor,
      action: deadLetter
        ? "OUTBOX_MESSAGE_DEAD_LETTER"
        : "OUTBOX_MESSAGE_FAILED",
      entityType: "OutboxMessage",
      entityId: updated.id,
      metadata: { provider: updated.provider },
    });
    return updated;
  });
}
