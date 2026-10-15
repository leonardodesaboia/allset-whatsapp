import type { Job } from "bullmq";
import { prisma } from "@/infrastructure/db/prisma-client";
import { processPendingReceivedAudio } from "@/application/messaging/process-pending-received-audio.usecase";
import { createInboundMediaDownloader } from "@/infrastructure/messaging/messaging-runtime";
import { createRuntimeStorage } from "@/infrastructure/storage/storage-runtime";
import { createAudioTranscriber } from "@/infrastructure/transcription/transcription-runtime";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";
import type { ReceivedAudioPayload } from "@/infrastructure/jobs/job-payloads";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

export async function processReceivedAudioProcessor(
  job: Job<ReceivedAudioPayload>,
): Promise<void> {
  const { inboundMessageId } = job.data;

  if (!env.OPENAI_API_KEY) {
    throw new Error("Worker de áudio não configurado: OPENAI_API_KEY é obrigatória");
  }

  const results = await processPendingReceivedAudio(
    prisma,
    createRuntimeStorage(),
    createInboundMediaDownloader(),
    createAudioTranscriber(),
    { inboundMessageId, limit: 1, logger },
  );

  const result = results[0];
  if (!result) {
    logger.info({ jobId: job.id, inboundMessageId }, "Áudio já processado ou não encontrado");
    return;
  }

  if (!result.ok) {
    if (result.terminal) {
      logger.warn({ jobId: job.id, ...result }, "Audio requires manual review; automatic retry disabled");
      return;
    }
    throw new Error(`Falha ao processar áudio ${inboundMessageId}: ${result.error}`);
  }

  // Routing the transcription can enqueue a reply. Drain it without waiting
  // for a later inbound event or periodic job.
  await publishJobSafe({
    name: JOB_NAME.MESSAGE_DISPATCH,
    jobId: `message-dispatch:audio:${inboundMessageId}`,
    payload: {},
  });

  logger.info({ jobId: job.id, inboundMessageId }, "Áudio processado com sucesso");
}
