import { describe, expect, it, vi } from "vitest";
import { EvolutionMessagingAdapter } from "./evolution-messaging-adapter";

describe("EvolutionMessagingAdapter", () => {
  it("sends text through the Evolution endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: { id: "external-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new EvolutionMessagingAdapter(
      { baseUrl: "https://evolution.example", apiKey: "key", instance: "allset" },
      { get: vi.fn(), getSignedUrl: vi.fn(), put: vi.fn(), delete: vi.fn() },
    );

    await expect(adapter.send({ recipient: "+5585999999999", payload: { version: 1, type: "TEXT", text: "Olá" }, idempotencyKey: "idempotency-1" })).resolves.toEqual({ externalId: "external-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://evolution.example/message/sendText/allset",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ apikey: "key", "x-idempotency-key": "idempotency-1" }) }),
    );
  });

  it("rejects an audio URL that Evolution cannot retrieve publicly", async () => {
    const adapter = new EvolutionMessagingAdapter(
      { baseUrl: "https://evolution.example", apiKey: "key", instance: "allset" },
      { get: vi.fn(), getSignedUrl: vi.fn().mockResolvedValue("local-storage://audio/1") , put: vi.fn(), delete: vi.fn() },
    );

    await expect(adapter.send({ recipient: "+5585999999999", payload: { version: 1, type: "AUDIO", assetId: "asset", storageKey: "audio/1", contentType: "audio/ogg" }, idempotencyKey: "idempotency-2" })).rejects.toThrow("URL HTTPS pública");
  });
});
