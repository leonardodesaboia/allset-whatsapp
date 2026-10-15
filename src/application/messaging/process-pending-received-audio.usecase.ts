import type { PrismaClient } from "@prisma/client";
import type { AudioTranscriber } from "../../domain/ports/audio-transcriber";
import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { routeInboundText } from "./route-inbound-text.usecase";
import { downloadReceivedAudio } from "./download-received-audio.usecase";
import { transcribeReceivedAudio } from "./transcribe-received-audio.usecase";
import type { OperationalLogger } from "../../domain/ports/operational-logger";
import { MediaDownloaderUnavailableError } from "../../domain/messaging/media-downloader-unavailable-error";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export async function processPendingReceivedAudio(prisma: PrismaClient, storage: StorageProvider, downloader: InboundMediaDownloader, transcriber: AudioTranscriber, input: { inboundMessageId?: string; limit: number; logger?: OperationalLogger }) {
  const ids = (await prisma.inboundMessage.findMany({
    // A transcript may already exist when routing failed. Keep recovering the
    // inbound until the conversation transaction has actually consumed it.
    where: { type: "AUDIO", processedAt: null, mediaProcessingFailedAt: null, ...(input.inboundMessageId ? { id: input.inboundMessageId } : {}) },
    orderBy: { receivedAt: "asc" }, take: input.limit, select: { id: true },
  })).map((message) => message.id);
  const results = [] as Array<{ inboundMessageId: string; ok: boolean; error?: string; terminal?: boolean }>;
  for (const inboundMessageId of ids) {
    try {
      const downloaded = await downloadReceivedAudio(prisma, storage, downloader, { inboundMessageId });
      if (!downloaded.ok) { results.push({ inboundMessageId, ok: false, error: downloaded.error.code }); continue; }
      const transcription = await transcribeReceivedAudio(prisma, storage, transcriber, { inboundMessageId });
      if (!transcription.ok) { results.push({ inboundMessageId, ok: false, error: transcription.error.code }); continue; }
      const inbound = await prisma.inboundMessage.findUnique({
        where: { id: inboundMessageId },
        select: { sender: true, provider: true },
      });
      if (!inbound) {
        results.push({ inboundMessageId, ok: false, error: "INBOUND_NOT_FOUND" });
        continue;
      }
      await routeInboundText(prisma, {
        inboundMessageId,
        phoneE164: inbound.sender,
        text: transcription.value.text,
        provider: inbound.provider,
      }, input.logger);
      results.push({ inboundMessageId, ok: true });
    } catch (error) {
      if (error instanceof MediaDownloaderUnavailableError) {
        const recorded = await prisma.$transaction(async (tx) => {
          const claimed = await tx.inboundMessage.updateMany({
            where: { id: inboundMessageId, processedAt: null, mediaProcessingFailedAt: null },
            data: { mediaProcessingFailedAt: new Date(), mediaProcessingError: error.code },
          });
          if (!claimed.count) return false;
          await recordAuditLog(tx, {
            actor: "system:audio-recovery", action: "INBOUND_MEDIA_NEEDS_MANUAL_REVIEW", entityType: "InboundMessage", entityId: inboundMessageId,
            metadata: { code: error.code, provider: error.provider ?? "unknown" },
          });
          return true;
        });
        // Only the winner reports this terminal failure. Periodic AND explicit
        // processing exclude it until an operator deliberately clears the marker.
        if (recorded) results.push({ inboundMessageId, ok: false, error: error.code, terminal: true });
        continue;
      }
      results.push({ inboundMessageId, ok: false, error: error instanceof Error ? error.message : "MEDIA_DOWNLOAD_FAILED" });
    }
  }
  return results;
}
