import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { processPendingReceivedAudio } from "./process-pending-received-audio.usecase";
import { routeInboundText } from "./route-inbound-text.usecase";
import { InMemoryStorageProvider } from "../../infrastructure/storage/in-memory-storage-provider";

vi.mock("./download-received-audio.usecase", () => ({ downloadReceivedAudio: vi.fn().mockResolvedValue({ ok: true, value: {} }) }));
vi.mock("./transcribe-received-audio.usecase", () => ({ transcribeReceivedAudio: vi.fn().mockResolvedValue({ ok: true, value: { text: "Oi" } }) }));
vi.mock("./route-inbound-text.usecase", () => ({ routeInboundText: vi.fn().mockResolvedValue({}) }));

describe("pending inbound audio", () => {
  it("processes both providers and routes transcripts with the persisted provider", async () => {
    const rows = [{ id: "new", provider: "whatsmiau", sender: "+5511999999999" }, { id: "old", provider: "evolution", sender: "+5511888888888" }];
    const prisma = { inboundMessage: {
      findMany: vi.fn(({ where }: { where: { provider?: string } }) => Promise.resolve(rows.filter((row) => !where.provider || row.provider === where.provider))),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => Promise.resolve(rows.find((row) => row.id === where.id))),
    } } as unknown as PrismaClient;
    const results = await processPendingReceivedAudio(prisma, new InMemoryStorageProvider(), { download: vi.fn() }, { transcribe: vi.fn() }, { limit: 10 });
    expect(results).toEqual([{ inboundMessageId: "new", ok: true }, { inboundMessageId: "old", ok: true }]);
    expect(prisma.inboundMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "AUDIO", processedAt: null, mediaProcessingFailedAt: null } }));
    expect(routeInboundText).toHaveBeenCalledWith(prisma, expect.objectContaining({ provider: "whatsmiau", inboundMessageId: "new", text: "Oi" }));
    expect(routeInboundText).toHaveBeenCalledWith(prisma, expect.objectContaining({ provider: "evolution", inboundMessageId: "old" }));
  });
});
