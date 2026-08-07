import type { PrismaClient } from "@prisma/client";
import type { InboundMessagePayload } from "../../domain/messaging/message";
import { recordAuditLog } from "../audit/record-audit-log.usecase";
import { Prisma } from "@prisma/client";
import { z } from "zod";
export interface ProcessInboundEventInput { provider: string; externalId: string; sender: string; recipient: string; payload: InboundMessagePayload; providerMetadata?: unknown; correlationId?: string; actor?: string; }
export async function processInboundEvent(prisma: PrismaClient, input: ProcessInboundEventInput) {
  z.object({ provider: z.string().trim().min(1).max(64), externalId: z.string().trim().min(1).max(200), sender: z.string().trim().min(1).max(32), recipient: z.string().trim().min(1).max(32) }).parse(input);
  try { return await prisma.$transaction(async (tx) => { const message = await tx.inboundMessage.create({ data: { provider: input.provider, externalId: input.externalId, sender: input.sender, recipient: input.recipient, type: input.payload.type, payload: input.payload as unknown as Prisma.InputJsonValue, ...(input.providerMetadata !== undefined ? { providerMetadata: input.providerMetadata as Prisma.InputJsonValue } : {}), ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}) } }); await recordAuditLog(tx, { actor: input.actor ?? "system:inbound", action: "INBOUND_MESSAGE_RECEIVED", entityType: "InboundMessage", entityId: message.id, metadata: { provider: input.provider, externalId: input.externalId } }); return { message, duplicate: false }; }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { const message = await prisma.inboundMessage.findUniqueOrThrow({ where: { provider_externalId: { provider: input.provider, externalId: input.externalId } } }); return { message, duplicate: true }; } throw error; }
}
