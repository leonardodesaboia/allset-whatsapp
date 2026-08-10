import type { PrismaClient } from "@prisma/client";
import type { AudioTranscriber } from "../../domain/ports/audio-transcriber";
import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { processContactConversationText } from "./process-contact-conversation-text.usecase";
import { downloadReceivedAudio } from "./download-received-audio.usecase";
import { transcribeReceivedAudio } from "./transcribe-received-audio.usecase";

export async function processPendingReceivedAudio(prisma: PrismaClient, storage: StorageProvider, downloader: InboundMediaDownloader, transcriber: AudioTranscriber, input: { inboundMessageId?: string; limit: number }) {
  const ids = input.inboundMessageId ? [input.inboundMessageId] : (await prisma.inboundMessage.findMany({
    where: { provider: "evolution", type: "AUDIO", OR: [{ receivedAudio: { is: null } }, { receivedAudio: { is: { transcription: null } } }] },
    orderBy: { receivedAt: "asc" }, take: input.limit, select: { id: true },
  })).map((message) => message.id);
  const results = [] as Array<{ inboundMessageId: string; ok: boolean; error?: string }>;
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
      await processContactConversationText(prisma, {
        inboundMessageId,
        phoneE164: inbound.sender,
        text: transcription.value.text,
        provider: inbound.provider,
      });
      results.push({ inboundMessageId, ok: true });
    } catch (error) { results.push({ inboundMessageId, ok: false, error: error instanceof Error ? error.message : "MEDIA_DOWNLOAD_FAILED" }); }
  }
  return results;
}
