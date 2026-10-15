import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceivedAudioPayload, MessageDispatchPayload } from "@/infrastructure/jobs/job-payloads";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, processAudio: vi.fn(), dispatch: vi.fn(), publish: vi.fn() }));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/infrastructure/db/prisma-client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/storage/storage-runtime", () => ({ createRuntimeStorage: () => ({}) }));
vi.mock("@/infrastructure/transcription/transcription-runtime", () => ({ createAudioTranscriber: () => ({}) }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/application/messaging/process-pending-received-audio.usecase", () => ({ processPendingReceivedAudio: mocks.processAudio }));
vi.mock("@/application/messaging/dispatch-outbox.usecase", () => ({ dispatchNextOutboxMessage: mocks.dispatch }));
vi.mock("@/infrastructure/jobs/publish-job", () => ({ publishJobSafe: mocks.publish }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, { OPENAI_API_KEY: "openai", WHATSMIAU_BASE_URL: "https://api.whatsmiau.dev/v2", WHATSMIAU_MEDIA_HOSTS: ["storage.whatsmiau.io"] });
  mocks.processAudio.mockResolvedValue([{ inboundMessageId: "audio", ok: true }]);
  mocks.dispatch.mockResolvedValue(null); mocks.publish.mockResolvedValue(undefined);
});

describe("worker messaging providers", () => {
  it("does not ask BullMQ to retry terminal media failures", async () => {
    mocks.processAudio.mockResolvedValue([{ inboundMessageId: "audio", ok: false, error: "MEDIA_DOWNLOADER_UNAVAILABLE", terminal: true }]);
    const { processReceivedAudioProcessor } = await import("./process-received-audio.processor");
    await expect(processReceivedAudioProcessor({ id: "job", data: { inboundMessageId: "audio" } } as Job<ReceivedAudioPayload>)).resolves.toBeUndefined();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("gives configuration retries distinct job IDs even when attempts stay unchanged", async () => {
    const { dispatchMessageProcessor } = await import("./dispatch-message.processor");
    for (const availableAt of [new Date(Date.now() + 300000), new Date(Date.now() + 600000)]) {
      mocks.dispatch.mockResolvedValueOnce({ id: "outbox", status: "FAILED", attempts: 0, availableAt }).mockResolvedValueOnce(null);
      await dispatchMessageProcessor({ id: "job", data: {} } as Job<MessageDispatchPayload>);
    }
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.publish.mock.calls[0]![0].jobId).not.toBe(mocks.publish.mock.calls[1]![0].jobId);
  });
  it.each(["whatsmiau", "evolution"])("processes received audio configured only for %s", async (provider) => {
    if (provider === "whatsmiau") Object.assign(mocks.env, { WHATSMIAU_API_KEY: "new", WHATSMIAU_INSTANCE: "AllSet" });
    else Object.assign(mocks.env, { EVOLUTION_API_KEY: "old", EVOLUTION_BASE_URL: "http://evolution:8080", EVOLUTION_INSTANCE: "AllSet" });
    const { processReceivedAudioProcessor } = await import("./process-received-audio.processor");
    await processReceivedAudioProcessor({ id: "job", data: { inboundMessageId: "audio" } } as Job<ReceivedAudioPayload>);
    expect(mocks.processAudio).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ download: expect.any(Function) }), expect.anything(), expect.objectContaining({ inboundMessageId: "audio", limit: 1, logger: expect.objectContaining({ error: expect.any(Function) }) }));
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ jobId: "message-dispatch:audio:audio" }));
  });
  it("propagates audio failure so BullMQ can retry", async () => {
    mocks.processAudio.mockResolvedValue([{ inboundMessageId: "audio", ok: false, error: "DOWNLOAD_FAILED" }]);
    const { processReceivedAudioProcessor } = await import("./process-received-audio.processor");
    await expect(processReceivedAudioProcessor({ id: "job", data: { inboundMessageId: "audio" } } as Job<ReceivedAudioPayload>)).rejects.toThrow("DOWNLOAD_FAILED");
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(["whatsmiau", "evolution"])("uses the shared dispatch registry with %s-only config", async (provider) => {
    if (provider === "whatsmiau") Object.assign(mocks.env, { WHATSMIAU_API_KEY: "new", WHATSMIAU_INSTANCE: "AllSet" });
    else Object.assign(mocks.env, { EVOLUTION_API_KEY: "old", EVOLUTION_BASE_URL: "http://evolution:8080", EVOLUTION_INSTANCE: "AllSet" });
    const { dispatchMessageProcessor } = await import("./dispatch-message.processor");
    await dispatchMessageProcessor({ id: "job", data: {} } as Job<MessageDispatchPayload>);
    const registry = mocks.dispatch.mock.calls[0]![1];
    expect(registry.get(provider)).toBeDefined();
    if (provider === "whatsmiau") expect(registry.get("evolution")).toBe(registry.get("whatsmiau"));
    else expect(registry.get("whatsmiau")).toBeUndefined();
  });
});
