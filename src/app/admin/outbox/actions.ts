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
  if (!actor || !parsedId.success) return;

  await prisma.$transaction(async (tx) => {
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
    if (updated.count === 0) return;

    await recordAuditLog(tx, {
      actor,
      action: "OUTBOX_MESSAGE_REQUEUED",
      entityType: "OutboxMessage",
      entityId: parsedId.data,
    });
  });
  revalidatePath("/admin/outbox");
}

export async function retryAllDeadLettersAction() {
  const actor = await currentActor();
  if (!actor) return;

  await prisma.$transaction(async (tx) => {
    const messages = await tx.outboxMessage.findMany({
      where: { status: "DEAD_LETTER" },
      select: { id: true },
    });
    if (messages.length === 0) return;

    await tx.outboxMessage.updateMany({
      where: { id: { in: messages.map(({ id }) => id) }, status: "DEAD_LETTER" },
      data: {
        status: "PENDING",
        attempts: 0,
        availableAt: new Date(),
        lastError: null,
        leaseExpiresAt: null,
      },
    });
    await Promise.all(messages.map(({ id }) => recordAuditLog(tx, {
      actor,
      action: "OUTBOX_MESSAGE_REQUEUED",
      entityType: "OutboxMessage",
      entityId: id,
    })));
  });
  revalidatePath("/admin/outbox");
}

export async function discardOutboxMessageAction(messageId: string) {
  const actor = await currentActor();
  const parsedId = messageIdSchema.safeParse(messageId);
  if (!actor || !parsedId.success) return;

  await prisma.$transaction(async (tx) => {
    const deleted = await tx.outboxMessage.deleteMany({
      where: { id: parsedId.data, status: "DEAD_LETTER" },
    });
    if (deleted.count === 0) return;

    await recordAuditLog(tx, {
      actor,
      action: "OUTBOX_MESSAGE_DISCARDED",
      entityType: "OutboxMessage",
      entityId: parsedId.data,
    });
  });
  revalidatePath("/admin/outbox");
}
