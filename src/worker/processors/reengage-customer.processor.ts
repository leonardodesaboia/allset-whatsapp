import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { reengageSilentCustomerConversations } from "@/application/customer/reengage-silent-customer-conversations.usecase";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";
import type { CustomerReengagementPayload } from "@/infrastructure/jobs/job-payloads";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

export async function reengageCustomerProcessor(
  job: Job<CustomerReengagementPayload>
): Promise<void> {
  const { conversationId, lastInboundAtMs } = job.data;

  const conversation = await prisma.customerBookingConversation.findUnique({
    where: { id: conversationId },
    select: { lastInboundAt: true },
  });

  // Stale job: the customer sent a new message (or the conversation ended)
  // since this delayed check was scheduled.
  if (
    !conversation?.lastInboundAt ||
    conversation.lastInboundAt.getTime() !== lastInboundAtMs
  ) {
    logger.info(
      { jobId: job.id, conversationId },
      "Conversa avançou desde o agendamento — reengajamento ignorado"
    );
    return;
  }

  const result = await reengageSilentCustomerConversations(prisma, {
    afterHours: env.CUSTOMER_REENGAGEMENT_AFTER_HOURS,
    conversationId,
  });
  if (result.reengaged) {
    await publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `customer-reengagement-dispatch:${job.id}`,
      payload: {},
    });
  }

  logger.info(
    { jobId: job.id, conversationId, ...result },
    "Reengajamento de cliente processado"
  );
}
