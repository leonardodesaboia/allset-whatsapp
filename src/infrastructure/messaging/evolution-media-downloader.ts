import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";
import type { EvolutionConfig } from "./evolution-messaging-adapter";

// Keep the base64 representation below the 20 MiB storage limit plus a small
// data-URI margin, before allocating a decoded Uint8Array.
const maxBase64Characters = Math.ceil((20 * 1024 * 1024 * 4) / 3) + 256;

/** Evolution-specific adapter; application code only depends on InboundMediaDownloader. */
export class EvolutionMediaDownloader implements InboundMediaDownloader {
  constructor(private readonly config: EvolutionConfig) {}

  async download(input: { externalId: string; contentType: string; providerMetadata: unknown }) {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(this.config.instance)}`, {
      method: "POST",
      headers: { apikey: this.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ message: input.providerMetadata, convertToMp4: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Evolution media download retornou ${response.status}`);
    const body = await response.json() as unknown;
    const base64 = this.findBase64(body);
    if (!base64) throw new Error("Evolution não retornou mídia em base64");
    if (base64.length > maxBase64Characters) throw new Error("Mídia recebida excede o tamanho máximo permitido");
    return { data: new Uint8Array(Buffer.from(base64, "base64")), contentType: input.contentType };
  }

  private findBase64(value: unknown): string | null {
    if (typeof value === "string") return value.replace(/^data:[^;]+;base64,/, "");
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    for (const key of ["base64", "media", "data"]) {
      if (typeof record[key] === "string") return (record[key] as string).replace(/^data:[^;]+;base64,/, "");
    }
    return null;
  }
}
