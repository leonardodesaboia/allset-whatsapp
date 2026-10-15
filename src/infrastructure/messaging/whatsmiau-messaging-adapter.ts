import type { StorageProvider } from "../../domain/ports/storage-provider";
import type { MessagingGateway, SendMessageInput, SendMessageResult } from "../../domain/ports/messaging-gateway";
import { ProviderAuthenticationError } from "../../domain/messaging/provider-authentication-error";

export interface WhatsMiauConfig { baseUrl: string; apiKey: string; instance: string; }
export class WhatsMiauMessagingAdapter implements MessagingGateway {
  constructor(private readonly config: WhatsMiauConfig, private readonly storage: StorageProvider) {}
  capabilities() { return { text: true, audio: true }; }
  private endpoint(path: string) { return `${this.config.baseUrl.replace(/\/$/, "")}/${path}/${encodeURIComponent(this.config.instance)}`; }
  async health() {
    const response = await fetch(this.endpoint("instance/connectionState"), { headers: { apikey: this.config.apiKey }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false };
    const data = await response.json() as { state?: string; suspended?: boolean; instance?: { state?: string } };
    return { ok: !data.suspended && (data.state ?? data.instance?.state) === "open" };
  }
  async send(input: SendMessageInput): Promise<SendMessageResult> {
    if (!/^\+?\d{8,15}(?:@s\.whatsapp\.net)?$/.test(input.recipient)) throw new Error("Destinatário inválido para WhatsMiau; use um telefone real, nunca LID");
    const number = input.recipient.split("@")[0]!.replace(/^\+/, "");
    let body: { number: string; text: string } | { number: string; audio: string };
    if (input.payload.type === "TEXT") body = { number, text: input.payload.text };
    else {
      const audio = await this.storage.getSignedUrl({ key: input.payload.storageKey, expiresInSeconds: 600 });
      if (!audio.startsWith("https://")) throw new Error("WhatsMiau exige URL HTTPS pública para áudio");
      body = { number, audio };
    }
    const action = input.payload.type === "TEXT" ? "sendText" : "sendWhatsAppAudio";
    const response = await fetch(this.endpoint(`message/${action}`), {
      method: "POST", headers: { apikey: this.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let body = "";
      let bytes = 0;
      try {
        while (reader && bytes < 2048) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = value.subarray(0, 2048 - bytes);
          body += decoder.decode(chunk, { stream: true }); bytes += chunk.length;
        }
      } catch { body = body || "Provider error body unavailable"; }
      finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
      const safeBody = body.replaceAll(this.config.apiKey, "[REDACTED]")
        .replace(/\d{8,}/g, (phone) => `***${phone.slice(-4)}`).replace(/[\r\n\t]/g, " ").slice(0, 400);
      const message = `WhatsMiau HTTP ${response.status}: ${safeBody}`;
      if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError(message, response.status);
      throw new Error(message);
    }
    // The response schema and provider idempotency support are undocumented.
    const data = await response.json().catch(() => null) as { key?: { id?: string } } | null;
    return { externalId: data?.key?.id ?? input.idempotencyKey };
  }
}
