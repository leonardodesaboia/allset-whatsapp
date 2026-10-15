import { processRuntimeReceivedAudio } from "@/infrastructure/messaging/received-audio-runtime";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({ inboundMessageId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).default(10) });

/** Worker-only: baixa mídia recebida, armazena-a e transcreve no mesmo fluxo idempotente. */
export async function POST(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await request.json()); } catch { return Response.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 }); }
  if (!env.OPENAI_API_KEY) return Response.json({ ok: false, error: "AUDIO_WORKER_NOT_CONFIGURED" }, { status: 503 });
  try {
    const results = await processRuntimeReceivedAudio(prisma, {
      limit: input.limit,
      ...(input.inboundMessageId !== undefined ? { inboundMessageId: input.inboundMessageId } : {}),
    });
    return Response.json({ ok: true, processed: results.length, results });
  } catch (error) { logger.error({ err: error, inboundMessageId: input.inboundMessageId }, "Falha ao baixar e transcrever áudio recebido"); return Response.json({ ok: false, error: "MEDIA_DOWNLOAD_FAILED" }, { status: 500 }); }
}
