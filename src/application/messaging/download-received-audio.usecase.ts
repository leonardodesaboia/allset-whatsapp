import type { PrismaClient } from "@prisma/client";
import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordReceivedAudio } from "./record-received-audio.usecase";

export async function downloadReceivedAudio(
  prisma: PrismaClient, storage: StorageProvider, downloader: InboundMediaDownloader, input: { inboundMessageId: string },
): Promise<Result<{ inboundMessageId: string }, DomainError>> {
  const existing = await prisma.receivedAudio.findUnique({ where: { inboundMessageId: input.inboundMessageId } });
  if (existing) return ok({ inboundMessageId: input.inboundMessageId });
  const inbound = await prisma.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
  if (!inbound || inbound.type !== "AUDIO" || !inbound.providerMetadata) return err(new DomainError("Mídia inbound não disponível", "INBOUND_MEDIA_NOT_FOUND"));
  const payload = inbound.payload as { externalMediaId?: unknown; contentType?: unknown };
  if (typeof payload.externalMediaId !== "string" || typeof payload.contentType !== "string") return err(new DomainError("Payload de áudio inválido", "INVALID_RECEIVED_AUDIO"));
  const media = await downloader.download({ externalId: payload.externalMediaId, contentType: payload.contentType, providerMetadata: inbound.providerMetadata });
  const recorded = await recordReceivedAudio(prisma, storage, { inboundMessageId: inbound.id, contentType: media.contentType, data: media.data });
  return recorded.ok ? ok({ inboundMessageId: inbound.id }) : recorded;
}
