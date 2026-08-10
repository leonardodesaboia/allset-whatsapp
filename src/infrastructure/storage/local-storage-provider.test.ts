import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageProvider } from "./local-storage-provider";

describe("LocalStorageProvider", () => {
  let baseDir: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "allset-storage-"));
    provider = new LocalStorageProvider(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("grava um arquivo e devolve metadados", async () => {
    const stored = await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1, 2, 3]),
      ownerId: "professional-1",
    });

    expect(stored.sizeBytes).toBe(3);
    const raw = await readFile(join(baseDir, "docs/rg.png"));
    expect([...raw]).toEqual([1, 2, 3]);
  });

  it("getSignedUrl devolve uma URL local com expiração embutida", async () => {
    await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1]),
      ownerId: "professional-1",
    });

    const url = await provider.getSignedUrl({ key: "docs/rg.png", expiresInSeconds: 60 });

    expect(url).toContain("docs/rg.png");
    expect(url).toContain("expires=");
  });

  it("delete remove o arquivo", async () => {
    await provider.put({
      key: "docs/rg.png",
      contentType: "image/png",
      data: new Uint8Array([1]),
      ownerId: "professional-1",
    });

    await provider.delete({ key: "docs/rg.png" });

    await expect(readFile(join(baseDir, "docs/rg.png"))).rejects.toThrow();
  });
});
