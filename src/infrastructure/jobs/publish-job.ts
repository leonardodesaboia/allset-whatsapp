import { type Queue } from "bullmq";
import { logger } from "../observability/logger";
import type { JobName } from "./job-names";
import type { JobPayloadMap } from "./job-payloads";

interface PublishJobInput<N extends JobName> {
  name: N;
  jobId: string;
  payload: JobPayloadMap[N];
  delay?: number;
}

/**
 * Fire-and-forget BullMQ publisher.
 * Silently skips when REDIS_URL is not configured (dev without worker).
 * On failure, logs the error but never throws — the business transaction
 * already committed to PostgreSQL and the item remains recoverable.
 */
export async function publishJobSafe<N extends JobName>(
  input: PublishJobInput<N>,
): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return;

  const prefix = process.env.JOB_QUEUE_PREFIX ?? "allset:development";

  try {
    const [{ getSharedConnection }, { getJobQueue }] = await Promise.all([
      import("./bullmq-connection"),
      import("./job-queue"),
    ]);

    const connection = getSharedConnection(redisUrl);
    const queue = getJobQueue(input.name, connection, prefix);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (queue as Queue<any>).add(input.name, input.payload, {
      jobId: input.jobId,
      ...(input.delay !== undefined ? { delay: input.delay } : {}),
    });

    logger.debug({ jobName: input.name, jobId: input.jobId, delay: input.delay }, "Job publicado");
  } catch (error) {
    logger.error(
      { err: error, jobName: input.name, jobId: input.jobId },
      "Falha ao publicar job — item permanece recuperável no PostgreSQL",
    );
  }
}
