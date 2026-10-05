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

  const now = new Date();
  const transcriptionLeaseUntil = new Date(now.getTime() + 5 * 60 * 1000);
  const claimed = await prisma.receivedAudio.updateMany({
    where: { id: audio.id, transcription: null, OR: [{ transcriptionLeaseUntil: null }, { transcriptionLeaseUntil: { lt: now } }] },
    data: { transcriptionLeaseUntil },
  });
  if (!claimed.count) return err(new DomainError("Transcrição já está em andamento", "TRANSCRIPTION_IN_PROGRESS"));

  try {
    const data = await storage.get({ key: audio.storageKey });
    const result = await transcriber.transcribe({ data, contentType: audio.contentType, language: "pt" });
    if (!result.text.trim()) throw new Error("A transcrição não retornou texto");
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.receivedAudio.updateMany({
        where: { id: audio.id, transcription: null, transcriptionLeaseUntil },
        data: { transcription: result.text.trim(), transcriptionLeaseUntil: null },
      });
      if (!updated.count) return false;
      await recordAuditLog(tx, {
        actor: "system:whisper", action: "RECEIVED_AUDIO_TRANSCRIBED",
        entityType: "ReceivedAudio", entityId: audio.id, metadata: { model: result.model },
      });
      return true;
    });
    if (!saved) return err(new DomainError("Outra tentativa assumiu a transcrição", "TRANSCRIPTION_IN_PROGRESS"));
    return ok({ text: result.text.trim(), alreadyTranscribed: false });
  } catch (error) {
    // Only release our own lease: another worker may have taken over after expiry.
    await prisma.receivedAudio.updateMany({
      where: { id: audio.id, transcription: null, transcriptionLeaseUntil },
      data: { transcriptionLeaseUntil: null },
    });
    throw error;
  }
}
