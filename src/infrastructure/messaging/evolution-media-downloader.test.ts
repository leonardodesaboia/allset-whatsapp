import { describe, expect, it, vi } from "vitest";
import { EvolutionMediaDownloader } from "./evolution-media-downloader";

describe("EvolutionMediaDownloader", () => {
  it("baixa e decodifica base64 sem expor a API ao caso de uso", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ base64: "AQID" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const downloader = new EvolutionMediaDownloader({ baseUrl: "https://evolution.test", apiKey: "secret", instance: "allset" });

    await expect(downloader.download({ externalId: "msg-1", contentType: "audio/ogg", providerMetadata: { key: { id: "msg-1" } } })).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "audio/ogg" });
    expect(fetchMock).toHaveBeenCalledWith("https://evolution.test/chat/getBase64FromMediaMessage/allset", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ apikey: "secret" }) }));
  });
});
