import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drainOutbox } from "./drain-outbox";
import { dispatchNextOutboxMessage } from "../../application/messaging/dispatch-outbox.usecase";
import { logger } from "../observability/logger";

vi.mock("../../application/messaging/dispatch-outbox.usecase", () => ({ dispatchNextOutboxMessage: vi.fn() }));
vi.mock("../observability/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
const prisma = {} as PrismaClient;
const registry = { get: vi.fn() };
describe("drainOutbox", () => {
  it("passes a failed backlog entry and sends the fresh reply in the same drain", async () => {
    vi.mocked(dispatchNextOutboxMessage).mockResolvedValueOnce({ id: "old", provider: "evolution", recipient: "+5511999999999", status: "FAILED", lastError: "WhatsMiau HTTP 400: invalid number" } as never)
      .mockResolvedValueOnce({ id: "new", status: "SENT" } as never).mockResolvedValueOnce(null);
    expect(await drainOutbox(prisma, registry, { actor: "test", limit: 20 })).toBe(2);
    expect(dispatchNextOutboxMessage).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ outboxMessageId: "old", provider: "evolution", recipient: "***9999" }), expect.any(String));
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("5511999999999");
  });
  it("bounds work even when the queue never empties", async () => {
    vi.mocked(dispatchNextOutboxMessage).mockResolvedValue({ status: "SENT" } as never);
    expect(await drainOutbox(prisma, registry, { actor: "test", limit: 3 })).toBe(3);
    expect(dispatchNextOutboxMessage).toHaveBeenCalledTimes(3);
  });
});
