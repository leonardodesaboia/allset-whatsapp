import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { ProviderAuthenticationError } from "../../domain/messaging/provider-authentication-error";
import { MediaDownloaderUnavailableError } from "../../domain/messaging/media-downloader-unavailable-error";
import { MockMessagingAdapter } from "../../infrastructure/messaging/mock-messaging-adapter";
import { StaticMessagingGatewayRegistry } from "../../infrastructure/messaging/messaging-gateway-registry";
import { drainOutbox } from "../../infrastructure/messaging/drain-outbox";
import { logger } from "../../infrastructure/observability/logger";
import { InMemoryStorageProvider } from "../../infrastructure/storage/in-memory-storage-provider";
import { enqueueOutboundMessage } from "./enqueue-outbound-message.usecase";
import { processInboundEvent } from "./process-inbound-event.usecase";
import { processPendingReceivedAudio } from "./process-pending-received-audio.usecase";

describe("persistent messaging recovery", () => {
  let prisma: PrismaClient; let stop: () => Promise<void>;
  const clock = new Date("2030-01-01T00:00:00Z");
  const actors = ["system:internal-scheduler", "system:audio-dispatch", "system:webhook-dispatch"];
  beforeAll(async () => { const db = await startTestDatabase(); prisma = db.prisma; stop = db.stop; }, 60_000);
  afterAll(async () => { await stop?.(); });
  beforeEach(async () => {
    await prisma.outboxMessage.deleteMany(); await prisma.messagingProviderState.deleteMany();
    await prisma.inboundMessage.deleteMany();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(clock);
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  const enqueue = (provider: string, key: string) => enqueueOutboundMessage(prisma, {
    provider, recipient: "+5511999999999", payload: { version: 1, type: "TEXT", text: key },
    idempotencyKey: key, actor: "test",
  });
  it("respects availableAt across all three drainers with increasing 30s/60s backoff", async () => {
    const gateway = new MockMessagingAdapter(); const send = vi.spyOn(gateway, "send").mockRejectedValue(new Error("HTTP 503"));
    const registry = new StaticMessagingGatewayRegistry([["whatsmiau", gateway]]);
    const queued = await enqueue("whatsmiau", "transient");
    const drain = (actor: string) => drainOutbox(prisma, registry, { actor, limit: 20 });
    await drain(actors[0]!);
    expect(await prisma.outboxMessage.findUnique({ where: { id: queued.id } })).toMatchObject({ attempts: 1, availableAt: new Date(clock.getTime() + 30000) });
    vi.setSystemTime(clock.getTime() + 15000); await Promise.all(actors.map(drain));
    expect(send).toHaveBeenCalledTimes(1);
    vi.setSystemTime(clock.getTime() + 30000); await drain(actors[1]!);
    expect(await prisma.outboxMessage.findUnique({ where: { id: queued.id } })).toMatchObject({ attempts: 2, availableAt: new Date(clock.getTime() + 90000) });
    vi.setSystemTime(clock.getTime() + 45000); await Promise.all(actors.map(drain));
    expect(send).toHaveBeenCalledTimes(2);
    vi.setSystemTime(clock.getTime() + 90000); await drain(actors[2]!);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403] as const)("pauses both aliases on HTTP %s without burning attempts, even across concurrent drainers/restarts", async (status) => {
    const gateway = new MockMessagingAdapter();
    const send = vi.spyOn(gateway, "send").mockRejectedValue(new ProviderAuthenticationError(`WhatsMiau HTTP ${status}: Invalid API Key`, status));
    const registry = () => new StaticMessagingGatewayRegistry([["whatsmiau", gateway], ["evolution", gateway]]);
    const first = await enqueue("evolution", "auth-first");
    await prisma.outboxMessage.update({ where: { id: first.id }, data: { attempts: 7, createdAt: new Date(0) } });
    await enqueue("whatsmiau", "auth-second");
    await Promise.all(actors.map((actor) => drainOutbox(prisma, registry(), { actor, limit: 20 })));
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1); expect(logger.warn).not.toHaveBeenCalled();
    expect(await prisma.outboxMessage.findUnique({ where: { id: first.id } })).toMatchObject({ status: "FAILED", attempts: 7 });
    expect(await prisma.outboxMessage.findUnique({ where: { idempotencyKey: "auth-second" } })).toMatchObject({ status: "PENDING", attempts: 0 });
    const state = await prisma.messagingProviderState.findUniqueOrThrow({ where: { provider: "whatsmiau" } });
    expect(state.blockedUntil).toEqual(new Date(clock.getTime() + 300000));
    vi.setSystemTime(clock.getTime() + 15000);
    await Promise.all(actors.map((actor) => drainOutbox(prisma, registry(), { actor, limit: 20 })));
    expect(send).toHaveBeenCalledTimes(1); expect(logger.error).toHaveBeenCalledTimes(1);
    const healthy = new MockMessagingAdapter(); await enqueue("other", "healthy");
    await drainOutbox(prisma, new StaticMessagingGatewayRegistry([["whatsmiau", gateway], ["evolution", gateway], ["other", healthy]]), { actor: "test", limit: 20 });
    expect(healthy.sent).toHaveLength(1);
    vi.setSystemTime(clock.getTime() + 300000); send.mockResolvedValue({ externalId: "fixed" });
    await drainOutbox(prisma, registry(), { actor: "test", limit: 20 });
    expect(await prisma.outboxMessage.count({ where: { status: "SENT" } })).toBe(3);
    expect(await prisma.outboxMessage.count({ where: { status: "DEAD_LETTER" } })).toBe(0);
  });
  it("marks unavailable legacy media for manual review once, including concurrent/explicit retries", async () => {
    const { message } = await processInboundEvent(prisma, { provider: "evolution", externalId: "old-audio", sender: "+5511999999999", recipient: "allset", payload: { version: 1, type: "AUDIO", externalMediaId: "old-audio", contentType: "audio/ogg" }, providerMetadata: { key: { id: "old-audio" } } });
    const download = vi.fn().mockRejectedValue(new MediaDownloaderUnavailableError("evolution"));
    const transcribe = vi.fn();
    const run = (inboundMessageId?: string) => processPendingReceivedAudio(prisma, new InMemoryStorageProvider(), { download }, { transcribe }, { limit: 10, ...(inboundMessageId ? { inboundMessageId } : {}) });
    const results = (await Promise.all([run(), run()])).flat();
    expect(results).toEqual([{ inboundMessageId: message.id, ok: false, error: "MEDIA_DOWNLOADER_UNAVAILABLE", terminal: true }]);
    expect(await prisma.inboundMessage.findUnique({ where: { id: message.id } })).toMatchObject({ processedAt: null, mediaProcessingFailedAt: clock, mediaProcessingError: "MEDIA_DOWNLOADER_UNAVAILABLE" });
    const calls = download.mock.calls.length;
    expect(await run()).toEqual([]); expect(await run(message.id)).toEqual([]);
    expect(download).toHaveBeenCalledTimes(calls); expect(transcribe).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { entityId: message.id, action: "INBOUND_MEDIA_NEEDS_MANUAL_REVIEW" } })).toBe(1);
  });
  it("keeps temporary media errors retryable", async () => {
    await processInboundEvent(prisma, { provider: "whatsmiau", externalId: "temporary", sender: "+5511999999999", recipient: "allset", payload: { version: 1, type: "AUDIO", externalMediaId: "temporary", contentType: "audio/ogg" }, providerMetadata: { mediaUrl: "https://storage.whatsmiau.io/media/test.ogg" } });
    const download = vi.fn().mockRejectedValue(new Error("Temporary storage outage"));
    for (let i = 0; i < 2; i++) await processPendingReceivedAudio(prisma, new InMemoryStorageProvider(), { download }, { transcribe: vi.fn() }, { limit: 10 });
    expect(download).toHaveBeenCalledTimes(2);
    expect(await prisma.inboundMessage.count({ where: { mediaProcessingFailedAt: { not: null } } })).toBe(0);
  });
});
