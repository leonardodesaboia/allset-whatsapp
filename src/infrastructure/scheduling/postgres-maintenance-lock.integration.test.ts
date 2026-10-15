import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { startTestDatabase } from "../../../tests/integration/test-db";
import { withMaintenanceLock } from "./postgres-maintenance-lock";
import { env } from "../../env";
import { createMessagingGatewayRegistry } from "../messaging/messaging-runtime";
import { drainOutbox } from "../messaging/drain-outbox";
import { enqueueOutboundMessage } from "../../application/messaging/enqueue-outbound-message.usecase";

describe("scheduler PostgreSQL coordination", () => {
  let prisma: PrismaClient; let stop: () => Promise<void>;
  beforeAll(async () => { const db = await startTestDatabase(); prisma = db.prisma; stop = db.stop; }, 60_000);
  afterAll(async () => { await stop?.(); });
  it("drains seven legacy rows plus the fresh reply through the WhatsMiau alias despite one send failure", async () => {
    const previous = { EVOLUTION_BASE_URL: env.EVOLUTION_BASE_URL, EVOLUTION_API_KEY: env.EVOLUTION_API_KEY, EVOLUTION_INSTANCE: env.EVOLUTION_INSTANCE, WHATSMIAU_API_KEY: env.WHATSMIAU_API_KEY, WHATSMIAU_INSTANCE: env.WHATSMIAU_INSTANCE };
    Object.assign(env, { EVOLUTION_BASE_URL: undefined, EVOLUTION_API_KEY: undefined, EVOLUTION_INSTANCE: undefined, WHATSMIAU_API_KEY: "fixture-key", WHATSMIAU_INSTANCE: "AllSet" });
    const fetchMock = vi.fn((_url, init: RequestInit) => Promise.resolve(
      JSON.parse(init.body as string).text === "old-0"
        ? new Response("invalid number", { status: 400 })
        : new Response(JSON.stringify({ key: { id: "sent" } })),
    ));
    vi.stubGlobal("fetch", fetchMock);
    try {
      for (let i = 0; i < 7; i++) await enqueueOutboundMessage(prisma, { provider: "evolution", recipient: "+5511999999999", payload: { version: 1, type: "TEXT", text: `old-${i}` }, idempotencyKey: `backlog-${i}`, actor: "test" });
      const fresh = await enqueueOutboundMessage(prisma, { provider: "whatsmiau", recipient: "+5511999999999", payload: { version: 1, type: "TEXT", text: "fresh reply" }, idempotencyKey: "fresh", actor: "test" });
      const registry = createMessagingGatewayRegistry();
      expect(registry.get("evolution")).toBe(registry.get("whatsmiau"));
      await drainOutbox(prisma, registry, { actor: "test", limit: 20 });
      expect(await prisma.outboxMessage.findUnique({ where: { id: fresh.id } })).toMatchObject({ status: "SENT" });
      expect(await prisma.outboxMessage.count({ where: { provider: "evolution", status: "SENT" } })).toBe(6);
      expect(await prisma.outboxMessage.findUnique({ where: { idempotencyKey: "backlog-0" } })).toMatchObject({ status: "FAILED", lastError: "WhatsMiau HTTP 400: invalid number" });
      expect(fetchMock.mock.calls.every(([url]) => url === "https://api.whatsmiau.dev/v2/message/sendText/AllSet")).toBe(true);
    } finally { Object.assign(env, previous); vi.unstubAllGlobals(); }
  });
  it("excludes concurrent maintenance and releases the lock after success or failure", async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = withMaintenanceLock(prisma, async () => { entered(); await gate; });
    await started;
    try {
      expect(await withMaintenanceLock(prisma, async () => { throw new Error("must not enter"); })).toBe(false);
    } finally { release(); }
    expect(await first).toBe(true);
    await expect(withMaintenanceLock(prisma, async () => { throw new Error("task failed"); })).rejects.toThrow("task failed");
    expect(await withMaintenanceLock(prisma, async () => {})).toBe(true);
  });
});
