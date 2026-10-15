import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env";
import { createInboundMediaDownloader, createMessagingGatewayRegistry, getMessagingIntegrationConfig } from "./messaging-runtime";
import { EvolutionMessagingAdapter } from "./evolution-messaging-adapter";
import { WhatsMiauMessagingAdapter } from "./whatsmiau-messaging-adapter";

vi.mock("../../env", () => ({ env: { WHATSMIAU_BASE_URL: "https://api.whatsmiau.dev/v2", WHATSMIAU_MEDIA_HOSTS: ["storage.whatsmiau.io"] } }));
vi.mock("../storage/storage-runtime", () => ({ createRuntimeStorage: () => ({}) }));
beforeEach(() => {
  Object.assign(env, { MESSAGING_DEFAULT_PROVIDER: "whatsmiau", WHATSMIAU_API_KEY: "key", WHATSMIAU_INSTANCE: "allset", EVOLUTION_BASE_URL: undefined, EVOLUTION_API_KEY: undefined, EVOLUTION_INSTANCE: undefined });
  vi.unstubAllGlobals();
});

describe("messaging provider runtime", () => {
  it("aliases persisted evolution rows to WhatsMiau when Evolution is absent", () => {
    const registry = createMessagingGatewayRegistry();
    expect(registry.get("whatsmiau")).toBeInstanceOf(WhatsMiauMessagingAdapter);
    expect(registry.get("evolution")).toBe(registry.get("whatsmiau"));
  });
  it("preserves both gateways when Evolution remains configured", () => {
    Object.assign(env, { EVOLUTION_BASE_URL: "https://evolution.example", EVOLUTION_API_KEY: "old", EVOLUTION_INSTANCE: "old" });
    const registry = createMessagingGatewayRegistry();
    expect(registry.get("evolution")).toBeInstanceOf(EvolutionMessagingAdapter);
    expect(registry.get("whatsmiau")).toBeInstanceOf(WhatsMiauMessagingAdapter);
  });
  it("keeps Evolution usable alone and refuses partial configurations", () => {
    Object.assign(env, { WHATSMIAU_API_KEY: undefined, WHATSMIAU_INSTANCE: undefined, EVOLUTION_BASE_URL: "https://evolution.example", EVOLUTION_API_KEY: "old", EVOLUTION_INSTANCE: "old" });
    expect(createMessagingGatewayRegistry().get("evolution")).toBeInstanceOf(EvolutionMessagingAdapter);
    expect(getMessagingIntegrationConfig()).toMatchObject({ provider: "evolution", apiKey: "old" });
    env.EVOLUTION_INSTANCE = undefined;
    expect(() => createMessagingGatewayRegistry()).toThrow("incompleta");
  });
  it("admin follows the selected provider while both remain configured", () => {
    Object.assign(env, { EVOLUTION_BASE_URL: "http://evolution:8080", EVOLUTION_API_KEY: "old", EVOLUTION_INSTANCE: "old" });
    expect(getMessagingIntegrationConfig().provider).toBe("whatsmiau");
    env.MESSAGING_DEFAULT_PROVIDER = "evolution";
    expect(getMessagingIntegrationConfig().provider).toBe("evolution");
  });
  it("routes inbound downloads by persisted provider when both services exist", async () => {
    Object.assign(env, { EVOLUTION_BASE_URL: "https://evolution.example", EVOLUTION_API_KEY: "old", EVOLUTION_INSTANCE: "old" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("audio", { headers: { "content-type": "audio/ogg" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ base64: "AQID" })));
    vi.stubGlobal("fetch", fetchMock);
    const downloader = createInboundMediaDownloader();
    await downloader.download({ externalId: "new", provider: "whatsmiau", contentType: "audio/ogg", providerMetadata: { mediaUrl: "https://storage.whatsmiau.io/media/new.ogg" } });
    await downloader.download({ externalId: "old", provider: "evolution", contentType: "audio/ogg", providerMetadata: { key: { id: "old" } } });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://storage.whatsmiau.io/media/new.ogg");
    expect(fetchMock.mock.calls[1]![0]).toBe("https://evolution.example/chat/getBase64FromMediaMessage/old");
  });
  it("does not try to decrypt old Evolution audio using WhatsMiau", async () => {
    await expect(createInboundMediaDownloader().download({ externalId: "old", provider: "evolution", contentType: "audio/ogg", providerMetadata: { key: { id: "old" } } })).rejects.toThrow("Downloader");
  });
});
