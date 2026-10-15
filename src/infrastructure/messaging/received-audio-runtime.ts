import type { PrismaClient } from "@prisma/client";
import { processPendingReceivedAudio } from "../../application/messaging/process-pending-received-audio.usecase";
import { dispatchNextOutboxMessage } from "../../application/messaging/dispatch-outbox.usecase";
import { createRuntimeStorage } from "../storage/storage-runtime";
import { createAudioTranscriber } from "../transcription/transcription-runtime";
import { createInboundMediaDownloader, createMessagingGatewayRegistry } from "./messaging-runtime";
import { publishJobSafe } from "../jobs/publish-job";
import { JOB_NAME } from "../jobs/job-names";

export async function processRuntimeReceivedAudio(prisma: PrismaClient, input: { inboundMessageId?: string; limit: number }) {
  const results = await processPendingReceivedAudio(prisma, createRuntimeStorage(), createInboundMediaDownloader(), createAudioTranscriber(), input);
  if (process.env.REDIS_URL) {
    await publishJobSafe({ name: JOB_NAME.MESSAGE_DISPATCH, jobId: `message-dispatch:audio-recovery:${Math.floor(Date.now() / 5000)}`, payload: {} });
  } else {
    await dispatchNextOutboxMessage(prisma, createMessagingGatewayRegistry(), "system:audio-dispatch");
  }
  return results;
}
