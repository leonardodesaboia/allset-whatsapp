import { randomUUID } from "node:crypto";
import type { PrismaClient, QuestionAudioAsset } from "@prisma/client";
import type { StorageProvider } from "../../domain/ports/storage-provider";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { QUESTIONS } from "../../domain/recruitment/conversation-definition";

const maxAudioBytes = 12 * 1024 * 1024;
const maxDurationMs = 10 * 60 * 1000;
const supportedAudioTypes = new Set(["audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm", "audio/wav"]);

export interface UploadQuestionAudioInput {
  questionKey: string;
  contentType: string;
  data: Uint8Array;
  durationMs?: number;
  language?: string;
  actor: string;
}

export async function uploadQuestionAudio(
  prisma: PrismaClient,
  storage: StorageProvider,
  input: UploadQuestionAudioInput,
): Promise<Result<QuestionAudioAsset, DomainError>> {
  if (
    !Object.hasOwn(QUESTIONS, input.questionKey) ||
    !supportedAudioTypes.has(input.contentType) ||
    input.data.byteLength === 0 ||
    input.data.byteLength > maxAudioBytes ||
    (input.durationMs !== undefined && (input.durationMs <= 0 || input.durationMs > maxDurationMs))
  ) {
    return err(new DomainError("Áudio inválido", "INVALID_AUDIO_ASSET"));
  }

  const key = `recruitment/questions/${input.questionKey}/${randomUUID()}`;
  const stored = await storage.put({ key, contentType: input.contentType, data: input.data, ownerId: input.actor });

  try {
    return await prisma.$transaction(async (tx) => {
      const latest = await tx.questionAudioAsset.findFirst({
        where: { questionKey: input.questionKey },
        orderBy: { version: "desc" },
      });
      if (latest) {
        await tx.questionAudioAsset.update({ where: { id: latest.id }, data: { isActive: false, replacedAt: new Date() } });
      }
      const asset = await tx.questionAudioAsset.create({
        data: {
          questionKey: input.questionKey,
          storageKey: stored.key,
          contentType: stored.contentType,
          sizeBytes: stored.sizeBytes,
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
          language: input.language ?? "pt-BR",
          version: (latest?.version ?? 0) + 1,
          createdBy: input.actor,
        },
      });
      await tx.auditLog.create({
        data: {
          actor: input.actor,
          action: "QUESTION_AUDIO_UPLOADED",
          entityType: "QuestionAudioAsset",
          entityId: asset.id,
          metadata: { questionKey: asset.questionKey, version: asset.version },
        },
      });
      return ok(asset);
    });
  } catch (error) {
    await storage.delete({ key: stored.key });
    throw error;
  }
}

export async function getQuestionAudioPreview(storage: StorageProvider, asset: QuestionAudioAsset): Promise<string> {
  return storage.getSignedUrl({ key: asset.storageKey, expiresInSeconds: 300 });
}
