import { z } from "zod";
import type { InboundMessagePayload } from "../../domain/messaging/message";

const schema = z.object({
  event: z.literal("messages.upsert"),
  data: z.object({
    key: z.object({ id: z.string().min(1).max(200), remoteJid: z.string(), remoteJidAlt: z.string().optional(), senderPn: z.string().optional(), fromMe: z.boolean().optional() }),
    senderPn: z.string().optional(),
    mediaUrl: z.string().optional(),
    message: z.object({
      conversation: z.string().optional(),
      extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
      mediaUrl: z.string().optional(),
      audioMessage: z.object({ mimetype: z.string().startsWith("audio/"), fileLength: z.union([z.string(), z.number()]).optional() }).optional(),
    }),
  }),
});

export function normalizeWhatsMiauWebhook(body: unknown, recipient = "allset"): { externalId: string; sender: string; recipient: string; payload: InboundMessagePayload; providerMetadata?: Record<string, unknown> } | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data.data.key.fromMe) return null;
  const { key, message, mediaUrl: dataMediaUrl, senderPn } = parsed.data.data;
  const phoneJid = /^\d{8,15}@s\.whatsapp\.net$/.test(key.remoteJid) ? key.remoteJid : null;
  // A LID is never a phone. Only explicit PN fields may resolve it; groups stay ignored.
  const realPhone = phoneJid ?? (key.remoteJid.endsWith("@lid")
    ? [key.remoteJidAlt, key.senderPn, senderPn].find((value) => value && /^\+?\d{8,15}(?:@s\.whatsapp\.net)?$/.test(value))
    : undefined);
  if (!realPhone) return null;
  const common = { externalId: key.id, sender: `+${realPhone.split("@")[0]!.replace(/^\+/, "")}`, recipient };
  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (text && Buffer.byteLength(text, "utf8") > 4096) return null;
  if (text) return { ...common, payload: { version: 1, type: "TEXT", text } };
  const audio = message.audioMessage;
  const mediaUrl = message.mediaUrl ?? dataMediaUrl;
  if (!audio || !mediaUrl) return null;
  return {
    ...common,
    payload: { version: 1, type: "AUDIO", externalMediaId: key.id, contentType: audio.mimetype },
    providerMetadata: { mediaUrl, mimetype: audio.mimetype, ...(audio.fileLength !== undefined ? { fileLength: audio.fileLength } : {}) },
  };
}
