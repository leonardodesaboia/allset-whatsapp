import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { reengageSilentConversations } from "@/application/recruitment/reengage-silent-conversations.usecase";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";
import type { RecruitmentReengagementPayload } from "@/infrastructure/jobs/job-payloads";

export async function reengageRecruitmentProcessor(
  job: Job<RecruitmentReengagementPayload>,
): Promise<void> {
  const { conversationId, reengagementCount } = job.data;

  const conversation = await prisma.recruitmentConversation.findUnique({
    where: { id: conversationId },
    select: { reengagementCount: true, state: true, lastInboundAt: true },
  });

  if (!conversation) {
    logger.info({ jobId: job.id, conversationId }, "Conversa não encontrada — reengajamento ignorado");
    return;
  }

  // Stale job: the conversation advanced or was already reengaged.
  if (conversation.reengagementCount !== reengagementCount) {
    logger.info(
      { jobId: job.id, conversationId, expected: reengagementCount, actual: conversation.reengagementCount },
      "Estado de reengajamento mudou desde que o job foi criado — ignorado",
    );
    return;
  }

  const result = await reengageSilentConversations(prisma, {
    afterHours: env.RECRUITMENT_REENGAGEMENT_AFTER_HOURS,
    maximumAttempts: env.RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS,
    conversationId,
  });

  logger.info({ jobId: job.id, conversationId, ...result }, "Reengajamento processado");
}
