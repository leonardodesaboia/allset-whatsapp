"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import type { OutboundMessageStatus } from "@prisma/client";
import { z } from "zod";
import { recordAuditLog } from "@/application/audit/record-audit-log.usecase";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";

const messageIdSchema = z.string().uuid();
const retryableStatuses: OutboundMessageStatus[] = ["FAILED", "DEAD_LETTER"];

async function currentActor(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const email = session?.user.email;
  if (!email) return null;

  const admin = await prisma.user.findFirst({
    where: { email, role: "ADMIN" },
    select: { email: true },
  });
  return admin?.email ?? null;
}

export async function retryOutboxMessageAction(messageId: string) {
  const actor = await currentActor();
  const parsedId = messageIdSchema.safeParse(messageId);
  if (!actor) return { ok: false as const, error: "Sessão expirada ou sem permissão." };
  if (!parsedId.success) return { ok: false as const, error: "Mensagem inválida." };

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.outboxMessage.updateMany({
      where: { id: parsedId.data, status: { in: retryableStatuses } },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count === 0) return false;

    await recordAuditLog(tx, {
      actor,
      action: "OUTBOX_MESSAGE_REQUEUED",
      entityType: "OutboxMessage",
      entityId: parsedId.data,
    });
    return true;
  });
  if (!updated) return { ok: false as const, error: "A mensagem não está disponível para reenvio." };
  revalidatePath("/admin/outbox");
  return { ok: true as const };
}

export async function retryAllDeadLettersAction() {
  const actor = await currentActor();
  if (!actor) return { ok: false as const, error: "Sessão expirada ou sem permissão." };

  const count = await prisma.$transaction(async (tx) => {
    const messages = await tx.outboxMessage.findMany({
      where: { status: "DEAD_LETTER" },
      select: { id: true },
    });
    if (messages.length === 0) return 0;

    const retried = await Promise.all(messages.map(async ({ id }) => {
      const updated = await tx.outboxMessage.updateMany({
        where: { id, status: "DEAD_LETTER" },
        data: {
          status: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          lastError: null,
          leaseExpiresAt: null,
        },
      });
      if (!updated.count) return false;
      await recordAuditLog(tx, {
        actor,
        action: "OUTBOX_MESSAGE_REQUEUED",
        entityType: "OutboxMessage",
        entityId: id,
      });
      return true;
    }));
    return retried.filter(Boolean).length;
  });
  if (!count) return { ok: false as const, error: "Não há falhas permanentes para reenfileirar." };
  revalidatePath("/admin/outbox");
  return { ok: true as const, count };
}

export async function discardOutboxMessageAction(messageId: string) {
  const actor = await currentActor();
  const parsedId = messageIdSchema.safeParse(messageId);
  if (!actor) return { ok: false as const, error: "Sessão expirada ou sem permissão." };
  if (!parsedId.success) return { ok: false as const, error: "Mensagem inválida." };

  const deleted = await prisma.$transaction(async (tx) => {
    const deleted = await tx.outboxMessage.deleteMany({
      where: { id: parsedId.data, status: "DEAD_LETTER" },
    });
    if (deleted.count === 0) return false;

    await recordAuditLog(tx, {
      actor,
      action: "OUTBOX_MESSAGE_DISCARDED",
      entityType: "OutboxMessage",
      entityId: parsedId.data,
    });
    return true;
  });
  if (!deleted) return { ok: false as const, error: "A mensagem não está disponível para descarte." };
  revalidatePath("/admin/outbox");
  return { ok: true as const };
}
