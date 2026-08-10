import { processPendingReceivedAudio } from "@/application/messaging/process-pending-received-audio.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { EvolutionMediaDownloader } from "@/infrastructure/messaging/evolution-media-downloader";
import { logger } from "@/infrastructure/observability/logger";
import { createRuntimeStorage } from "@/infrastructure/storage/storage-runtime";
import { createAudioTranscriber } from "@/infrastructure/transcription/transcription-runtime";
import { env } from "@/env";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({ inboundMessageId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).default(10) });

/** Worker-only: baixa mídia Evolution, armazena-a e transcreve no mesmo fluxo idempotente. */
export async function POST(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 }); }
  if (!env.EVOLUTION_BASE_URL || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE) return Response.json({ ok: false, error: "EVOLUTION_NOT_CONFIGURED" }, { status: 503 });
  try {
    const storage = createRuntimeStorage();
    const downloader = new EvolutionMediaDownloader({ baseUrl: env.EVOLUTION_BASE_URL, apiKey: env.EVOLUTION_API_KEY, instance: env.EVOLUTION_INSTANCE });
    const transcriber = createAudioTranscriber();
    const results = await processPendingReceivedAudio(prisma, storage, downloader, transcriber, {
      limit: input.limit,
      ...(input.inboundMessageId !== undefined ? { inboundMessageId: input.inboundMessageId } : {}),
    });
    return Response.json({ ok: true, processed: results.length, results });
  } catch (error) { logger.error({ err: error, inboundMessageId: input.inboundMessageId }, "Falha ao baixar e transcrever áudio Evolution"); return Response.json({ ok: false, error: "MEDIA_DOWNLOAD_FAILED" }, { status: 500 }); }
}
