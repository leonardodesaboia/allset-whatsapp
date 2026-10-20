import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { logger } from "@/infrastructure/observability/logger";
import type { MessageDispatchPayload } from "@/infrastructure/jobs/job-payloads";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";
import { getNextOutboxDispatchAt } from "@/application/messaging/next-outbox-dispatch-at.usecase";
import { retryConfirmedBookings } from "@/application/marketplace/notify-opportunity.usecase";

const batchLimit = 20;

// Shared runtime includes WhatsMiau and the legacy evolution alias when Evolution is absent.
// Registry is created once per worker process lifecycle.
let registry: ReturnType<typeof createMessagingGatewayRegistry> | null = null;
function getRegistry() {
  if (!registry) registry = createMessagingGatewayRegistry();
  return registry;
}

export async function dispatchMessageProcessor(
  job: Job<MessageDispatchPayload>,
): Promise<void> {
  const reg = getRegistry();
  // Pedidos confirmados sem profissional elegível são distribuídos assim que
  // houver alguém inscrita.
  await retryConfirmedBookings(prisma);
  let dispatched = 0;

  while (dispatched < batchLimit) {
    const result = await dispatchNextOutboxMessage(prisma, reg);
    if (!result) break;
    if (result.correlationId && result.idempotencyKey.endsWith(":offer") && result.status === "SENT") {
      // O prazo começa no envio de cada proposta; agenda a expiração.
      const opportunity = await prisma.serviceOpportunity.findUnique({
        where: { id: result.correlationId },
        select: { id: true, expiresAt: true },
      });
      if (opportunity)
        await publishJobSafe({
          name: JOB_NAME.OPPORTUNITY_EXPIRATION,
          jobId: `opportunity-expiration:${opportunity.id}:${opportunity.expiresAt.getTime()}`,
          payload: { opportunityId: opportunity.id },
          delay: Math.max(0, opportunity.expiresAt.getTime() - Date.now()),
        });
    }
    if (result.status === "FAILED") {
      await publishJobSafe({
        name: JOB_NAME.MESSAGE_DISPATCH,
        // Authentication probes preserve attempts; include the persisted schedule
        // so a completed BullMQ retry does not swallow the next cooldown probe.
        jobId: `outbox-retry:${result.id}:${result.attempts}:${result.availableAt.getTime()}`,
        payload: {},
        delay: Math.max(0, result.availableAt.getTime() - Date.now()),
      });
    }
    dispatched += 1;
  }

  // The WhatsApp interval stops the loop early: schedule the next pass for
  // when the next message (or the throttle) becomes available.
  const nextAt = await getNextOutboxDispatchAt(prisma);
  if (nextAt) {
    await publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `drain-continuation:${job.id}:${Date.now()}`,
      payload: {},
      delay: Math.max(1000, nextAt.getTime() - Date.now()),
    });
  }

  logger.info({ jobId: job.id, dispatched }, "Outbox drenada pelo worker");
}
