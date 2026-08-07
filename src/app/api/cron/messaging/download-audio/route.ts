import { processPendingReceivedAudio } from "@/application/messaging/process-pending-received-audio.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { EvolutionMediaDownloader } from "@/infrastructure/messaging/evolution-media-downloader";
import { createRuntimeStorage } from "@/infrastructure/storage/storage-runtime";
import { createAudioTranscriber } from "@/infrastructure/transcription/transcription-runtime";
import { env } from "@/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  if (!env.EVOLUTION_BASE_URL || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE || !env.OPENAI_API_KEY) return Response.json({ ok: false, error: "AUDIO_WORKER_NOT_CONFIGURED" }, { status: 503 });
  const results = await processPendingReceivedAudio(prisma, createRuntimeStorage(), new EvolutionMediaDownloader({ baseUrl: env.EVOLUTION_BASE_URL, apiKey: env.EVOLUTION_API_KEY, instance: env.EVOLUTION_INSTANCE }), createAudioTranscriber(), { limit: 10 });
  return Response.json({ ok: true, processed: results.length, results });
}
