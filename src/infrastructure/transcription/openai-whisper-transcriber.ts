import type { AudioTranscriber, AudioTranscriptionInput, AudioTranscriptionResult } from "../../domain/ports/audio-transcriber";

const supportedTypes = new Set(["audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm", "audio/wav"]);

/** Adapter da API de transcrição; `whisper-1` permanece isolado da aplicação. */
export class OpenAiWhisperTranscriber implements AudioTranscriber {
  constructor(private readonly apiKey: string, private readonly baseUrl = "https://api.openai.com/v1") {}

  async transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    if (!supportedTypes.has(input.contentType) || input.data.byteLength === 0) {
      throw new Error("Formato de áudio não suportado para transcrição");
    }
    const form = new FormData();
    const audioBytes = Uint8Array.from(input.data);
    form.append("file", new Blob([audioBytes.buffer], { type: input.contentType }), this.fileName(input.contentType));
    form.append("model", "whisper-1");
    if (input.language) form.append("language", input.language);

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!response.ok) throw new Error(`OpenAI transcription retornou ${response.status}`);
    const body = await response.json() as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) throw new Error("OpenAI transcription não retornou texto");
    return { text: body.text.trim(), model: "whisper-1" };
  }

  private fileName(contentType: string): string {
    const extension = contentType.split("/")[1] ?? "audio";
    return `inbound.${extension}`;
  }
}
