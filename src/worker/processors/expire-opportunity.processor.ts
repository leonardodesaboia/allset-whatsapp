import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { logger } from "@/infrastructure/observability/logger";
import type { OpportunityExpirationPayload } from "@/infrastructure/jobs/job-payloads";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

export async function expireOpportunityProcessor(
  job: Job<OpportunityExpirationPayload>
): Promise<void> {
  const { opportunityId } = job.data;

  const opportunity = await prisma.serviceOpportunity.findUnique({
    where: { id: opportunityId },
    select: { status: true, expiresAt: true },
  });

  if (!opportunity || opportunity.status !== "OPEN") {
    logger.info(
      { jobId: job.id, opportunityId },
      "Oportunidade não está aberta — expiração ignorada"
    );
    return;
  }

  const now = new Date();
  if (opportunity.expiresAt > now) {
    const remainingMs = opportunity.expiresAt.getTime() - now.getTime();
    await publishJobSafe({
      name: JOB_NAME.OPPORTUNITY_EXPIRATION,
      jobId: `opportunity-expiration:${opportunityId}:${opportunity.expiresAt.getTime()}:recheck:${job.id}`,
      payload: { opportunityId },
      delay: remainingMs,
    });
    return;
  }

  const result = await expireOpportunities(prisma, { opportunityId });
  if (result.expired) {
    await publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `expiration-dispatch:${opportunityId}`,
      payload: {},
    });
  }
  logger.info(
    { jobId: job.id, opportunityId, ...result },
    "Expiração processada"
  );
}
