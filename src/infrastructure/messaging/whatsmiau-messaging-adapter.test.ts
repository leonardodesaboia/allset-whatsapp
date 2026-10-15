import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsMiauMessagingAdapter } from "./whatsmiau-messaging-adapter";

afterEach(() => vi.unstubAllGlobals());
const storage = { get: vi.fn(), getSignedUrl: vi.fn().mockResolvedValue("https://media.example/a.ogg"), put: vi.fn(), delete: vi.fn() };
const adapter = () => new WhatsMiauMessagingAdapter({ baseUrl: "https://api.whatsmiau.dev/v2", apiKey: "secret", instance: "Atendimento01" }, storage);
describe("WhatsMiauMessagingAdapter", () => {
  it("sends text with apikey and no undocumented idempotency header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: { id: "external" } }))); vi.stubGlobal("fetch", fetchMock);
    await expect(adapter().send({ recipient: "+5511999999999", payload: { version: 1, type: "TEXT", text: "Oi" }, idempotencyKey: "local" })).resolves.toEqual({ externalId: "external" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.whatsmiau.dev/v2/message/sendText/Atendimento01", expect.objectContaining({ headers: { apikey: "secret", "content-type": "application/json" }, body: JSON.stringify({ number: "5511999999999", text: "Oi" }) }));
  });
  it("sends audio using sendWhatsAppAudio and preserves the local fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await expect(adapter().send({ recipient: "+5511999999999", payload: { version: 1, type: "AUDIO", assetId: "a", storageKey: "a.ogg", contentType: "audio/ogg" }, idempotencyKey: "local" })).resolves.toEqual({ externalId: "local" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.whatsmiau.dev/v2/message/sendWhatsAppAudio/Atendimento01", expect.objectContaining({ body: JSON.stringify({ number: "5511999999999", audio: "https://media.example/a.ogg" }) }));
  });
});
