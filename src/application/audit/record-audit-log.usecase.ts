import type { Prisma, PrismaClient } from "@prisma/client";

export interface RecordAuditLogInput {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function recordAuditLog(
  tx: Prisma.TransactionClient | PrismaClient,
  input: RecordAuditLogInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actor: input.actor,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      // exactOptionalPropertyTypes: só inclui a chave quando há metadata,
      // em vez de atribuir `undefined` explicitamente a um campo opcional.
      ...(input.metadata !== undefined ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
    },
  });
}
