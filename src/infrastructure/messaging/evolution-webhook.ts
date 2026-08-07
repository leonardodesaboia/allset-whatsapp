import type { InboundMessagePayload } from "../../domain/messaging/message";
import { compareSecret } from "../auth/compare-secret";

export function isValidEvolutionWebhook(secret: string | undefined, supplied: string | null): boolean { return compareSecret(secret, supplied); }
export function normalizeEvolutionWebhook(body: unknown): { externalId: string; sender: string; recipient: string; payload: InboundMessagePayload } | null {
  const event = body as { data?: { key?: { id?: string; remoteJid?: string; fromMe?: boolean }; message?: { conversation?: string; extendedTextMessage?: { text?: string }; audioMessage?: { mediaKey?: string; mimetype?: string } } } };
  const data = event.data;
  if (!data) return null;
  const key = data.key;
  if (!key?.id || !key.remoteJid || key.fromMe) return null;
  const rawPhone = key.remoteJid.replace(/@.+$/, "");
  // Grupos e identificadores internos não podem criar leads. Persistimos o
  // telefone canônico para não duplicar o cadastro manual (que usa E.164).
  if (!/^\d{8,15}$/.test(rawPhone)) return null;
  const sender = `+${rawPhone}`;
  const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text;
  if (text) return { externalId: key.id, sender, recipient: "allset", payload: { version: 1, type: "TEXT", text } };
  const audio = data.message?.audioMessage; if (audio?.mediaKey && audio.mimetype) return { externalId: key.id, sender, recipient: "allset", payload: { version: 1, type: "AUDIO", externalMediaId: key.id, contentType: audio.mimetype } };
  return null;
}
