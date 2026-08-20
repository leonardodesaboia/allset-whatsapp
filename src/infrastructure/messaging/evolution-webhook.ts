import type { InboundMessagePayload } from "../../domain/messaging/message";
import { compareSecret } from "../auth/compare-secret";

const ALLOWED_AUDIO_MIMETYPES = new Set([
  "audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm", "audio/wav", "audio/aac",
]);
const MAX_TEXT_BYTES = 4_096;

export function isValidEvolutionWebhook(secret: string | undefined, supplied: string | null): boolean { return compareSecret(secret, supplied); }
export function normalizeEvolutionWebhook(body: unknown): { externalId: string; sender: string; recipient: string; payload: InboundMessagePayload; providerMetadata?: Record<string, unknown> } | null {
  const event = body as { data?: { key?: { id?: string; remoteJid?: string; fromMe?: boolean; participant?: string }; message?: { conversation?: string; extendedTextMessage?: { text?: string }; audioMessage?: { mediaKey?: string; mimetype?: string; directPath?: string; url?: string; fileEncSha256?: string; fileSha256?: string; fileLength?: string | number } } } };
  const data = event.data;
  if (!data) return null;
  const key = data.key;
  if (!key?.id || !key.remoteJid || key.fromMe) return null;
  if (key.remoteJid.endsWith("@g.us")) return null;
  const rawPhone = key.remoteJid.replace(/@.+$/, "");
  // Grupos e identificadores internos não podem criar leads. Persistimos o
  // telefone canônico para não duplicar o cadastro manual (que usa E.164).
  if (!/^\d{8,15}$/.test(rawPhone)) return null;
  const sender = `+${rawPhone}`;
  const rawText = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
  if (rawText) {
    const text = rawText.length > MAX_TEXT_BYTES ? rawText.slice(0, MAX_TEXT_BYTES) : rawText;
    return { externalId: key.id, sender, recipient: "allset", payload: { version: 1, type: "TEXT", text } };
  }
  const audio = data.message?.audioMessage;
  if (audio?.mediaKey && audio.mimetype) {
    // Strip parameters (e.g. "; codecs=opus") and reject unknown types.
    const baseMimetype = audio.mimetype.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_AUDIO_MIMETYPES.has(baseMimetype)) return null;
    // Persist only the retrieval fields. Some Evolution configurations include
    // an inline base64 blob in the raw webhook, which must not enter the DB.
    const audioMessage = {
      mediaKey: audio.mediaKey,
      mimetype: baseMimetype,
      ...(audio.directPath ? { directPath: audio.directPath } : {}),
      ...(audio.url ? { url: audio.url } : {}),
      ...(audio.fileEncSha256 ? { fileEncSha256: audio.fileEncSha256 } : {}),
      ...(audio.fileSha256 ? { fileSha256: audio.fileSha256 } : {}),
      ...(audio.fileLength !== undefined ? { fileLength: audio.fileLength } : {}),
    };
    const mediaKey = { id: key.id, remoteJid: key.remoteJid, fromMe: false, ...(key.participant ? { participant: key.participant } : {}) };
    return { externalId: key.id, sender, recipient: "allset", payload: { version: 1, type: "AUDIO", externalMediaId: key.id, contentType: baseMimetype }, providerMetadata: { key: mediaKey, message: { audioMessage } } };
  }
  return null;
}
