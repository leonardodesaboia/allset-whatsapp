import type { PrismaClient } from "@prisma/client";
import type { MessagingGatewayRegistry } from "../../domain/ports/messaging-gateway";
import type { OutboundMessagePayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

const maxAttempts = 8;
// A Evolution pode demorar em redes móveis. Uma lease mais longa reduz a
// reivindicação concorrente durante uma entrega ainda em curso; o protocolo de
// entrega permanece at-least-once e usa a chave de idempotência do provider.
const leaseMs = 5 * 60_000;
const retryDelayMs = (attempt: number) => Math.min(3_600_000, 1_000 * 2 ** Math.min(attempt, 10));
const safeError = (error: unknown) =>
  (error instanceof Error ? error.message : "Falha desconhecida de mensageria").slice(0, 500);

export async function dispatchNextOutboxMessage(
  prisma: PrismaClient,
  registry: MessagingGatewayRegistry,
  actor = "system:outbox",
) {
  const now = new Date();
  const candidate = await prisma.outboxMessage.findFirst({
    where: {
      OR: [
        { status: { in: ["PENDING", "FAILED"] }, availableAt: { lte: now } },
        { status: "SENDING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;

  const claimed = await prisma.outboxMessage.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      ...(candidate.status === "SENDING"
        ? { leaseExpiresAt: { lte: now } }
        : { availableAt: { lte: now } }),
    },
    data: {
      status: "SENDING",
      attempts: { increment: 1 },
      leaseExpiresAt: new Date(Date.now() + leaseMs),
    },
  });
  if (!claimed.count) return null;

  const gateway = registry.get(candidate.provider);
  if (!gateway) {
    return fail(prisma, candidate.id, candidate.attempts + 1, `Provider não registrado: ${candidate.provider}`, actor);
  }
  if (candidate.type === "AUDIO" && !gateway.capabilities().audio) {
    return fail(prisma, candidate.id, maxAttempts, "Provider não suporta áudio", actor);
  }

  try {
    const sent = await gateway.send({
      recipient: candidate.recipient,
      payload: candidate.payload as unknown as OutboundMessagePayload,
      idempotencyKey: candidate.idempotencyKey,
      ...(candidate.correlationId ? { correlationId: candidate.correlationId } : {}),
    });
    return prisma.$transaction(async (tx) => {
      const updated = await tx.outboxMessage.update({
        where: { id: candidate.id },
        data: { status: "SENT", sentAt: new Date(), externalId: sent.externalId, lastError: null, leaseExpiresAt: null },
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
    return fail(prisma, candidate.id, candidate.attempts + 1, safeError(error), actor);
  }
}

async function fail(prisma: PrismaClient, id: string, attempts: number, error: string, actor: string) {
  const deadLetter = attempts >= maxAttempts;
  const updated = await prisma.outboxMessage.update({
    where: { id },
    data: {
      status: deadLetter ? "DEAD_LETTER" : "FAILED",
      lastError: error,
      leaseExpiresAt: null,
      ...(deadLetter ? {} : { availableAt: new Date(Date.now() + retryDelayMs(attempts)) }),
    },
  });
  await recordAuditLog(prisma, {
    actor,
    action: deadLetter ? "OUTBOX_MESSAGE_DEAD_LETTER" : "OUTBOX_MESSAGE_FAILED",
    entityType: "OutboxMessage",
    entityId: updated.id,
    metadata: { provider: updated.provider },
  });
  return updated;
}
