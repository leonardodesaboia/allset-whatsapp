import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { createMessagingGatewayRegistry } from "@/infrastructure/messaging/messaging-runtime";
import { dispatchNextOutboxMessage } from "@/application/messaging/dispatch-outbox.usecase";
import { logger } from "@/infrastructure/observability/logger";
import type { MessageDispatchPayload } from "@/infrastructure/jobs/job-payloads";

const batchLimit = 20;

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
  let dispatched = 0;

  while (dispatched < batchLimit) {
    const result = await dispatchNextOutboxMessage(prisma, reg);
    if (!result) break;
    dispatched += 1;
  }

  logger.info({ jobId: job.id, dispatched }, "Outbox drenada pelo worker");
}
