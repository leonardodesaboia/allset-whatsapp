import type { PrismaClient } from "@prisma/client";
import type { AudioTranscriber } from "../../domain/ports/audio-transcriber";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

/**
 * A transcrição é uma ajuda de acessibilidade, não uma decisão de seleção.
 * Falhas não apagam o áudio e podem ser revisadas manualmente.
 */
export async function transcribeReceivedAudio(
  prisma: PrismaClient,
  storage: StorageProvider,
  transcriber: AudioTranscriber,
  input: { inboundMessageId: string },
): Promise<Result<{ text: string; alreadyTranscribed: boolean }, DomainError>> {
  const audio = await prisma.receivedAudio.findUnique({ where: { inboundMessageId: input.inboundMessageId } });
  if (!audio) return err(new DomainError("Áudio recebido não encontrado", "RECEIVED_AUDIO_NOT_FOUND"));
  if (audio.transcription) return ok({ text: audio.transcription, alreadyTranscribed: true });

  const data = await storage.get({ key: audio.storageKey });
  const result = await transcriber.transcribe({ data, contentType: audio.contentType, language: "pt" });
  await prisma.$transaction(async (tx) => {
    await tx.receivedAudio.update({ where: { id: audio.id }, data: { transcription: result.text } });
    await recordAuditLog(tx, {
      actor: "system:whisper",
      action: "RECEIVED_AUDIO_TRANSCRIBED",
      entityType: "ReceivedAudio",
      entityId: audio.id,
      metadata: { model: result.model },
    });
  });
  return ok({ text: result.text, alreadyTranscribed: false });
}
