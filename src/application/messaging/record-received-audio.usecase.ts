import { randomUUID } from "node:crypto";
import type { PrismaClient, ReceivedAudio } from "@prisma/client";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";

const maxAudioBytes = 20 * 1024 * 1024;
const maxDurationMs = 60 * 60 * 1000;
const supportedAudioTypes = new Set(["audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm", "audio/wav"]);
export async function recordReceivedAudio(prisma: PrismaClient, storage: StorageProvider, input: { inboundMessageId: string; contentType: string; data: Uint8Array; durationMs?: number }): Promise<Result<ReceivedAudio, DomainError>> {
  if (!supportedAudioTypes.has(input.contentType) || input.data.byteLength === 0 || input.data.byteLength > maxAudioBytes || (input.durationMs !== undefined && (input.durationMs <= 0 || input.durationMs > maxDurationMs))) return err(new DomainError("Áudio recebido inválido", "INVALID_RECEIVED_AUDIO"));
  const existing = await prisma.receivedAudio.findUnique({ where: { inboundMessageId: input.inboundMessageId } });
  if (existing) return ok(existing);
  const inbound = await prisma.inboundMessage.findUnique({ where: { id: input.inboundMessageId } });
  if (!inbound) return err(new DomainError("Mensagem inbound não encontrada", "INBOUND_NOT_FOUND"));
  const key = `messaging/inbound/${inbound.id}/${randomUUID()}`;
  const stored = await storage.put({ key, contentType: input.contentType, data: input.data, ownerId: inbound.sender });
  try { const audio = await prisma.receivedAudio.create({ data: { inboundMessageId: inbound.id, storageKey: stored.key, contentType: stored.contentType, sizeBytes: stored.sizeBytes, ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}) } }); return ok(audio); } catch (error) { await storage.delete({ key: stored.key }); const concurrent = await prisma.receivedAudio.findUnique({ where: { inboundMessageId: input.inboundMessageId } }); if (concurrent) return ok(concurrent); throw error; }
}
export async function getReceivedAudioPreview(storage: StorageProvider, audio: ReceivedAudio): Promise<string> { return storage.getSignedUrl({ key: audio.storageKey, expiresInSeconds: 300 }); }
