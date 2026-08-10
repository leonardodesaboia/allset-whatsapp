import { env } from "../../env";
import { OpenAiWhisperTranscriber } from "./openai-whisper-transcriber";

export function createAudioTranscriber() {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY não configurada para transcrição");
  return new OpenAiWhisperTranscriber(env.OPENAI_API_KEY);
}
