export interface TextMessagePayload {
  version: 1;
  type: "TEXT";
  text: string;
}
export interface AudioMessagePayload { version: 1; type: "AUDIO"; assetId: string; storageKey: string; contentType: string; }
export type OutboundMessagePayload = TextMessagePayload | AudioMessagePayload;

interface InboundTextMessagePayload {
  version: 1;
  type: "TEXT";
  text: string;
}
interface InboundAudioMessagePayload { version: 1; type: "AUDIO"; externalMediaId: string; contentType: string; }
export type InboundMessagePayload = InboundTextMessagePayload | InboundAudioMessagePayload;

export function textPayload(text: string): TextMessagePayload {
  const normalized = text.trim();
  if (!normalized) throw new Error("Mensagem de texto não pode ser vazia");
  return { version: 1, type: "TEXT", text: normalized };
}
export function audioPayload(asset: { id: string; storageKey: string; contentType: string }): AudioMessagePayload { if (!asset.id || !asset.storageKey || !asset.contentType.startsWith("audio/")) throw new Error("Asset de áudio inválido"); return { version: 1, type: "AUDIO", assetId: asset.id, storageKey: asset.storageKey, contentType: asset.contentType }; }
