import type { Prisma, PrismaClient } from "@prisma/client";
import type { OutboundMessagePayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { z } from "zod";

type Database = PrismaClient | Prisma.TransactionClient;
export interface EnqueueOutboundMessageInput { provider: string; recipient: string; payload: OutboundMessagePayload; idempotencyKey: string; correlationId?: string; actor: string; }
const inputSchema = z.object({ provider: z.string().trim().min(1).max(64), recipient: z.string().trim().min(1).max(32), idempotencyKey: z.string().trim().min(1).max(200) });

export async function enqueueOutboundMessage(database: Database, input: EnqueueOutboundMessageInput) {
  inputSchema.parse(input);
  const message = await database.outboxMessage.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: { provider: input.provider, recipient: input.recipient, type: input.payload.type, payload: input.payload as unknown as Prisma.InputJsonValue, idempotencyKey: input.idempotencyKey, ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}) },
    update: {},
  });
  await recordAuditLog(database, { actor: input.actor, action: "OUTBOX_MESSAGE_ENQUEUED", entityType: "OutboxMessage", entityId: message.id, metadata: { provider: input.provider, correlationId: input.correlationId } });
  return message;
}
