import { describe, expect, it, vi } from "vitest";
import { OpenAiWhisperTranscriber } from "./openai-whisper-transcriber";

describe("OpenAiWhisperTranscriber", () => {
  it("sends a supported audio file to the Whisper transcription endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "Sim, eu trabalhei." }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const transcriber = new OpenAiWhisperTranscriber("secret-key");

    await expect(transcriber.transcribe({ data: new Uint8Array([1, 2, 3]), contentType: "audio/ogg", language: "pt" })).resolves.toEqual({ text: "Sim, eu trabalhei.", model: "whisper-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer secret-key" } }),
    );
  });

  it("does not send unsupported files to OpenAI", async () => {
    const transcriber = new OpenAiWhisperTranscriber("secret-key");
    await expect(transcriber.transcribe({ data: new Uint8Array([1]), contentType: "application/pdf" })).rejects.toThrow("Formato de áudio");
  });
});
