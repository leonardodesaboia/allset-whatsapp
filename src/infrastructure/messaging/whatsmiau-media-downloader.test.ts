import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsMiauMediaDownloader } from "./whatsmiau-media-downloader";

afterEach(() => vi.unstubAllGlobals());
const input = (mediaUrl = "https://storage.whatsmiau.io/media/id.ogg") => ({ externalId: "id", contentType: "audio/ogg", providerMetadata: { mediaUrl } });
describe("WhatsMiauMediaDownloader", () => {
  it("downloads audio directly without credentials or redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg; codecs=opus" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsMiauMediaDownloader().download(input())).resolves.toEqual({ data: new Uint8Array([1, 2, 3]), contentType: "audio/ogg" });
    expect(fetchMock).toHaveBeenCalledWith(input().providerMetadata.mediaUrl, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    expect(fetchMock.mock.calls[0]![1].headers).toBeUndefined();
  });
  it.each(["http://storage.whatsmiau.io/a", "https://evil.test/a", "https://storage.whatsmiau.io.evil.test/a", "https://user:pass@storage.whatsmiau.io/a", "https://storage.whatsmiau.io:444/a"])("rejects unsafe URL %s before fetching", async (url) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsMiauMediaDownloader().download(input(url))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("supports an explicit host allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a", { headers: { "content-type": "audio/mpeg" } })));
    await expect(new WhatsMiauMediaDownloader({ hosts: ["media.example"] }).download(input("https://media.example/a"))).resolves.toMatchObject({ contentType: "audio/mpeg" });
  });
  it("rejects a redirect without fetching its target", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.test/a" } })); vi.stubGlobal("fetch", fetchMock);
    await expect(new WhatsMiauMediaDownloader().download(input())).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([ { "content-type": "text/html" }, { "content-type": "audio/ogg", "content-length": "26214401" } ])("rejects invalid headers %j", async (headers) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a", { headers })));
    await expect(new WhatsMiauMediaDownloader().download(input())).rejects.toThrow();
  });
  it("limits streamed bytes even without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("abcd", { headers: { "content-type": "audio/ogg" } })));
    await expect(new WhatsMiauMediaDownloader({ maxBytes: 3 }).download(input())).rejects.toThrow("limite");
  });
  it("aborts stalled downloads on timeout", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    })));
    await expect(new WhatsMiauMediaDownloader({ timeoutMs: 5 }).download(input())).rejects.toThrow();
  });
});
