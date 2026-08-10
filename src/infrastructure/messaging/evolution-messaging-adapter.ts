import type { StorageProvider } from "../../domain/ports/storage-provider";
import type { MessagingGateway, SendMessageInput, SendMessageResult } from "../../domain/ports/messaging-gateway";

export interface EvolutionConfig { baseUrl: string; apiKey: string; instance: string; }
export class EvolutionMessagingAdapter implements MessagingGateway {
  constructor(private readonly config: EvolutionConfig, private readonly storage: StorageProvider) {}
  capabilities() { return { text: true, audio: true }; }
  async health() {
    const response = await fetch(`${this.endpoint("instance/connectionState")}/${encodeURIComponent(this.config.instance)}`, {
      headers: { apikey: this.config.apiKey },
    });
    return { ok: response.ok };
  }
  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const action = input.payload.type === "TEXT" ? "sendText" : "sendMedia";
    const body = input.payload.type === "TEXT"
      ? { number: this.toEvolutionPhone(input.recipient), text: input.payload.text }
      : await this.audioBody(input.payload.storageKey, input.payload.assetId, this.toEvolutionPhone(input.recipient));
    const response = await fetch(`${this.endpoint(`message/${action}`)}/${encodeURIComponent(this.config.instance)}`, {
      method: "POST",
      headers: { apikey: this.config.apiKey, "content-type": "application/json", "x-idempotency-key": input.idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Evolution retornou ${response.status}`);
    const data = await response.json() as { key?: { id?: string } };
    return { externalId: data.key?.id ?? input.idempotencyKey };
  }

  private endpoint(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}/${path}`;
  }

  private toEvolutionPhone(recipient: string): string {
    const phone = recipient.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(phone)) throw new Error("Destinatário inválido para Evolution");
    return phone;
  }

  private async audioBody(storageKey: string, assetId: string, recipient: string) {
    const media = await this.storage.getSignedUrl({ key: storageKey, expiresInSeconds: 600 });
    if (!media.startsWith("https://")) {
      throw new Error("Evolution exige uma URL HTTPS pública e temporária para enviar áudio");
    }
    return { number: recipient, mediatype: "audio", media, fileName: `${assetId}.audio` };
  }
}
