export interface AudioTranscriptionInput {
  data: Uint8Array;
  contentType: string;
  language?: string;
}

export interface AudioTranscriptionResult {
  text: string;
  model: "whisper-1";
}

/** Porta para transformar fala em texto sem acoplar o domínio à OpenAI. */
export interface AudioTranscriber {
  transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
}
