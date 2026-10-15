import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./whatsmiau/webhook/route";
import { POST as evolutionPOST } from "./evolution/webhook/route";

const mocks = vi.hoisted(() => ({
  persist: vi.fn(), audio: vi.fn(), route: vi.fn(), dispatch: vi.fn(), publish: vi.fn(),
}));
vi.mock("@/env", () => ({ env: { WHATSMIAU_WEBHOOK_SECRET: "a".repeat(32), EVOLUTION_WEBHOOK_SECRET: "a".repeat(32), WHATSAPP_NUMBER: "5511888888888" } }));
vi.mock("@/infrastructure/db/prisma-client", () => ({ prisma: {} }));
vi.mock("@/infrastructure/observability/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/application/messaging/process-inbound-event.usecase", () => ({ processInboundEvent: mocks.persist }));
vi.mock("@/application/messaging/route-inbound-text.usecase", () => ({ routeInboundText: mocks.route }));
vi.mock("@/infrastructure/jobs/publish-job", () => ({ publishJobSafe: mocks.publish }));
vi.mock("@/application/messaging/dispatch-outbox.usecase", () => ({ dispatchNextOutboxMessage: mocks.dispatch }));
vi.mock("@/infrastructure/messaging/messaging-runtime", () => ({ createMessagingGatewayRegistry: () => ({}) }));
vi.mock("@/infrastructure/messaging/received-audio-runtime", () => ({ processRuntimeReceivedAudio: mocks.audio }));

const event = { event: "messages.upsert", data: { key: { id: "msg", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false }, message: { conversation: "Oi" } } };
function request(body: unknown, secret = "a".repeat(32)) { return new Request("https://allset.example/api/messaging/whatsmiau/webhook", { method: "POST", headers: { "x-allset-webhook-secret": secret }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.persist.mockResolvedValue({ duplicate: false, message: { id: "inbound" } });
  mocks.audio.mockResolvedValue([]); mocks.publish.mockResolvedValue(undefined);
  vi.stubEnv("REDIS_URL", "");
  mocks.route.mockResolvedValue({ routed: "opportunity" }); mocks.dispatch.mockResolvedValue(null);
});

describe("WhatsMiau webhook route", () => {
  it("authenticates before accepting payloads and ignores updates", async () => {
    expect((await POST(request(event, "wrong"))).status).toBe(401);
    expect(await (await POST(request({ ...event, event: "messages.update" }))).json()).toEqual({ ok: true, ignored: true });
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it("persists text with the new provider and routes the conversation with inline dispatch", async () => {
    expect((await POST(request(event))).status).toBe(200);
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "whatsmiau" }));
    expect(mocks.route).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "whatsmiau", inboundMessageId: "inbound" }));
    expect(mocks.dispatch).toHaveBeenCalled();
  });
  it("starts audio processing immediately after persistence without awaiting completion", async () => {
    mocks.audio.mockReturnValue(new Promise(() => {}));
    const response = await POST(request({ ...event, data: { ...event.data, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", fileLength: "18432" }, mediaUrl: "https://storage.whatsmiau.io/media/msg.ogg" } } }));
    expect(response.status).toBe(202);
    expect(mocks.audio).toHaveBeenCalledWith(expect.anything(), { inboundMessageId: "inbound", limit: 1 });
    expect(mocks.persist.mock.invocationCallOrder[0]).toBeLessThan(mocks.audio.mock.invocationCallOrder[0]!);
    expect(mocks.route).not.toHaveBeenCalled();
  });
  it("does not reprocess duplicate audio", async () => {
    mocks.persist.mockResolvedValue({ duplicate: true, message: { id: "inbound", processedAt: new Date() } });
    await POST(request({ ...event, data: { ...event.data, message: { audioMessage: { mimetype: "audio/ogg" }, mediaUrl: "https://storage.whatsmiau.io/media/msg.ogg" } } }));
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it("publishes received audio to BullMQ and avoids inline processing with Redis", async () => {
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    await POST(request({ ...event, data: { ...event.data, message: { audioMessage: { mimetype: "audio/ogg" }, mediaUrl: "https://storage.whatsmiau.io/media/msg.ogg" } } }));
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ payload: { inboundMessageId: "inbound" } }));
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it("recovers duplicate unprocessed text using the canonical router", async () => {
    mocks.persist.mockResolvedValue({ duplicate: true, message: { id: "inbound", processedAt: null } });
    expect(await (await POST(request(event))).json()).toMatchObject({ recovered: true });
    expect(mocks.route).toHaveBeenCalled();
  });
  it("retains Evolution routing and queue publication during the first rollout deploy", async () => {
    await evolutionPOST(request(event));
    expect(mocks.persist).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "evolution", recipient: "+5511888888888" }));
    expect(mocks.route).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: "evolution" }));
    await evolutionPOST(request({ ...event, data: { ...event.data, message: { audioMessage: { mimetype: "audio/ogg", mediaKey: "old" } } } }));
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ payload: { inboundMessageId: "inbound" } }));
    expect(mocks.audio).not.toHaveBeenCalled();
  });
  it("preserves the production payload limit", async () => {
    const req = request(event); req.headers.set("content-length", "1048577");
    expect((await POST(req)).status).toBe(413);
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
