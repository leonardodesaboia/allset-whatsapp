import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";

export class WhatsMiauMediaDownloader implements InboundMediaDownloader {
  constructor(private readonly config: { hosts?: string[]; maxBytes?: number; timeoutMs?: number } = {}) {}

  async download(input: { externalId: string; contentType: string; providerMetadata: unknown }) {
    const metadata = input.providerMetadata as { mediaUrl?: unknown } | null;
    if (typeof metadata?.mediaUrl !== "string") throw new Error("WhatsMiau mediaUrl ausente");
    const url = new URL(metadata.mediaUrl);
    const hosts = this.config.hosts ?? ["storage.whatsmiau.io"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.includes(url.hostname.toLowerCase())) {
      throw new Error("WhatsMiau mediaUrl fora da allowlist HTTPS");
    }
    // Reject all redirects, including same-host redirects. Never forward API credentials to storage.
    const response = await fetch(url.href, { redirect: "error", signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000) });
    const maxBytes = this.config.maxBytes ?? 25 * 1024 * 1024;
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!response.ok || !contentType?.startsWith("audio/") || Number(response.headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new Error("WhatsMiau download: status, content-type ou limite de tamanho inválido");
    }
    if (!response.body) throw new Error("WhatsMiau download sem conteúdo");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error("WhatsMiau áudio excede limite de tamanho");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return { data, contentType };
  }
}
