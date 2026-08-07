import { processRecruitmentAnswer } from "@/application/recruitment/conversation-engine.usecase";
import { transcribeReceivedAudio } from "@/application/messaging/transcribe-received-audio.usecase";
import { env } from "@/env";
import { prisma } from "@/infrastructure/db/prisma-client";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { createRuntimeStorage } from "@/infrastructure/storage/storage-runtime";
import { logger } from "@/infrastructure/observability/logger";
import { createAudioTranscriber } from "@/infrastructure/transcription/transcription-runtime";
import { z } from "zod";

export const runtime = "nodejs";

const bodySchema = z.object({ inboundMessageId: z.string().uuid() });

/** Worker-only: transcreve um áudio já persistido e tenta avançar a conversa. */
export async function POST(request: Request) {
  if (!compareSecret(env.INTERNAL_JOB_SECRET, request.headers.get("x-allset-job-secret"))) {
    return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(await request.json());
  } catch {
    return Response.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const transcription = await transcribeReceivedAudio(prisma, createRuntimeStorage(), createAudioTranscriber(), input);
    if (!transcription.ok) return Response.json({ ok: false, error: transcription.error.code }, { status: 404 });
    const conversation = await processRecruitmentAnswer(prisma, {
      inboundMessageId: input.inboundMessageId,
      text: transcription.value.text,
    });
    return Response.json({ ok: true, transcription: transcription.value.text, conversation });
  } catch (error) {
    logger.error({ err: error, inboundMessageId: input.inboundMessageId }, "Falha ao transcrever áudio recebido");
    return Response.json({ ok: false, error: "TRANSCRIPTION_FAILED" }, { status: 500 });
  }
}
