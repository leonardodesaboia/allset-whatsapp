import type { MessagingGateway } from "../../domain/ports/messaging-gateway";
import type { InboundMediaDownloader } from "../../domain/ports/inbound-media-downloader";
import { env } from "../../env";
import { createRuntimeStorage } from "../storage/storage-runtime";
import { EvolutionMessagingAdapter } from "./evolution-messaging-adapter";
import { EvolutionMediaDownloader } from "./evolution-media-downloader";
import { WhatsMiauMessagingAdapter } from "./whatsmiau-messaging-adapter";
import { WhatsMiauMediaDownloader } from "./whatsmiau-media-downloader";
import { StaticMessagingGatewayRegistry } from "./messaging-gateway-registry";

function evolutionConfig() {
  const values = [env.EVOLUTION_BASE_URL, env.EVOLUTION_API_KEY, env.EVOLUTION_INSTANCE];
  if (values.every(Boolean)) return { baseUrl: env.EVOLUTION_BASE_URL!, apiKey: env.EVOLUTION_API_KEY!, instance: env.EVOLUTION_INSTANCE! };
  if (values.some(Boolean)) throw new Error("Configuração da Evolution incompleta");
  return undefined;
}

/** Admin keeps working with Evolution-only env during the first rollout deploy. */
export function getMessagingIntegrationConfig() {
  const evolution = Boolean(env.EVOLUTION_BASE_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCE);
  const whatsmiau = Boolean(env.WHATSMIAU_API_KEY && env.WHATSMIAU_INSTANCE);
  const useWhatsMiau = !evolution || (whatsmiau && env.MESSAGING_DEFAULT_PROVIDER !== "evolution");
  return useWhatsMiau
    ? { baseUrl: env.WHATSMIAU_BASE_URL, apiKey: env.WHATSMIAU_API_KEY, instance: env.WHATSMIAU_INSTANCE, label: "WhatsMiau", provider: "whatsmiau", prefix: "WHATSMIAU" }
    : { baseUrl: env.EVOLUTION_BASE_URL, apiKey: env.EVOLUTION_API_KEY, instance: env.EVOLUTION_INSTANCE, label: "Evolution", provider: "evolution", prefix: "EVOLUTION" };
}

export function createMessagingGatewayRegistry() {
  const entries: Array<[string, MessagingGateway]> = [];
  const evolution = evolutionConfig();
  if (evolution) entries.push(["evolution", new EvolutionMessagingAdapter(evolution, createRuntimeStorage())]);
  if (env.WHATSMIAU_API_KEY && env.WHATSMIAU_INSTANCE) {
    const gateway = new WhatsMiauMessagingAdapter({ baseUrl: env.WHATSMIAU_BASE_URL, apiKey: env.WHATSMIAU_API_KEY, instance: env.WHATSMIAU_INSTANCE }, createRuntimeStorage());
    entries.push(["whatsmiau", gateway]);
    // Outbox rows and existing conversations retain their persisted provider.
    if (!evolution) entries.push(["evolution", gateway]);
  } else if (env.WHATSMIAU_API_KEY || env.WHATSMIAU_INSTANCE) {
    throw new Error("Configuração do WhatsMiau incompleta");
  }
  return new StaticMessagingGatewayRegistry(entries);
}

/** Resolve using the persisted inbound provider, preserving Evolution media retrieval when configured. */
export function createInboundMediaDownloader(): InboundMediaDownloader {
  const evolution = evolutionConfig();
  const whatsmiau = new WhatsMiauMediaDownloader({ hosts: env.WHATSMIAU_MEDIA_HOSTS });
  return {
    async download(input) {
      if (input.provider === "whatsmiau") return whatsmiau.download(input);
      if (input.provider === "evolution" && evolution) return new EvolutionMediaDownloader(evolution).download(input);
      // Compatibility for URL-backed records carrying the legacy provider. Old encrypted
      // Evolution media still requires its original configured API; never send it to WhatsMiau.
      if (input.provider === "evolution" && input.providerMetadata && typeof input.providerMetadata === "object" && "mediaUrl" in input.providerMetadata) return whatsmiau.download(input);
      throw new Error(`Downloader não configurado para provider: ${input.provider}`);
    },
  };
}
