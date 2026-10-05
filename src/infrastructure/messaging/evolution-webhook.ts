import type { InboundMessagePayload } from "../../domain/messaging/message";
import { compareSecret } from "../auth/compare-secret";
import { z } from "zod";

const webhookSchema = z.object({
  data: z.object({
    key: z.object({
      id: z.string().min(1).max(200),
      remoteJid: z.string(),
      remoteJidAlt: z.string().optional(),
      fromMe: z.boolean().optional(),
      participant: z.string().optional(),
    }),
    message: z.object({
      conversation: z.string().optional(),
      extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
      audioMessage: z.object({
        mediaKey: z.string().optional(),
        mimetype: z.string().optional(),
        directPath: z.string().optional(),
        url: z.string().optional(),
        fileEncSha256: z.string().optional(),
        fileSha256: z.string().optional(),
        fileLength: z.union([z.string(), z.number()]).optional(),
      }).optional(),
    }).optional(),
  }),
});

const ALLOWED_AUDIO_MIMETYPES = new Set([
  "audio/mpeg", "audio/ogg", "audio/mp4", "audio/webm", "audio/wav", "audio/aac",
]);
const MAX_TEXT_BYTES = 4_096;

export function isValidEvolutionWebhook(secret: string | undefined, supplied: string | null): boolean { return compareSecret(secret, supplied); }
export function normalizeEvolutionWebhook(body: unknown, recipient = "allset"): { externalId: string; sender: string; recipient: string; payload: InboundMessagePayload; providerMetadata?: Record<string, unknown> } | null {
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data.data;
  const key = data.key;
  if (!key?.id || !key.remoteJid || key.fromMe) return null;
  // New WhatsApp versions can send a LID plus the canonical phone in remoteJidAlt.
  const phoneJid = key.remoteJid.endsWith("@lid") ? key.remoteJidAlt : key.remoteJid;
  if (!phoneJid || !/^\d{8,15}@(s\.whatsapp\.net|c\.us)$/.test(phoneJid)) return null;
  const rawPhone = phoneJid.replace(/@.+$/, "");
  // Grupos e identificadores internos não podem criar leads. Persistimos o
  // telefone canônico para não duplicar o cadastro manual (que usa E.164).
  if (!/^\d{8,15}$/.test(rawPhone)) return null;
  const sender = `+${rawPhone}`;
  const rawText = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
  if (rawText) {
    const text = rawText.length > MAX_TEXT_BYTES ? rawText.slice(0, MAX_TEXT_BYTES) : rawText;
    return { externalId: key.id, sender, recipient, payload: { version: 1, type: "TEXT", text } };
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
    return { externalId: key.id, sender, recipient, payload: { version: 1, type: "AUDIO", externalMediaId: key.id, contentType: baseMimetype }, providerMetadata: { key: mediaKey, message: { audioMessage } } };
  }
  return null;
}
