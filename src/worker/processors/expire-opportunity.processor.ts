import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { logger } from "@/infrastructure/observability/logger";
import type { OpportunityExpirationPayload } from "@/infrastructure/jobs/job-payloads";

export async function expireOpportunityProcessor(
  job: Job<OpportunityExpirationPayload>,
): Promise<void> {
  const { opportunityId } = job.data;

  const opportunity = await prisma.serviceOpportunity.findUnique({
    where: { id: opportunityId },
    select: { status: true, expiresAt: true },
  });

  if (!opportunity || opportunity.status !== "OPEN") {
    logger.info({ jobId: job.id, opportunityId }, "Oportunidade não está aberta — expiração ignorada");
    return;
  }

  const now = new Date();
  if (opportunity.expiresAt > now) {
    const remainingMs = opportunity.expiresAt.getTime() - now.getTime();
    logger.warn(
      { jobId: job.id, opportunityId, expiresAt: opportunity.expiresAt.toISOString(), remainingMs },
      "Job disparado antes do prazo — aguardando reprocessamento com backoff",
    );
    throw new Error(`opportunity ${opportunityId} expires in ${remainingMs}ms`);
  }

  const result = await expireOpportunities(prisma, { opportunityId });
  logger.info({ jobId: job.id, opportunityId, ...result }, "Expiração processada");
}
