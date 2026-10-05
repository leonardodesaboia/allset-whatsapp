import { describe, expect, it, vi } from "vitest";
import { checkSystemHealth } from "./system-health";

function fakePrisma(
  overrides: {
    queryRawOk?: boolean;
    pending?: number;
    deadLetter?: number;
  } = {}
) {
  const queryRawOk = overrides.queryRawOk ?? true;
  return {
    $queryRaw: vi.fn(async () => {
      if (!queryRawOk) throw new Error("connection refused");
      return [{ "?column?": 1 }];
    }),
    outboxMessage: {
      count: vi.fn(async ({ where }: { where: { status: unknown } }) => {
        const status = where.status as { in?: string[] } | string;
        if (typeof status === "object" && status.in)
          return overrides.pending ?? 0;
        return overrides.deadLetter ?? 0;
      }),
    },
  };
}

describe("checkSystemHealth", () => {
  it("reports ok when the database is reachable and Redis is not configured", async () => {
    const result = await checkSystemHealth(fakePrisma() as never, {
      redisConfigured: false,
      pingRedis: vi.fn(),
    });
    expect(result).toEqual({
      ok: true,
      database: "ok",
      redis: "not_configured",
      outbox: { pending: 0, deadLetter: 0 },
    });
  });

  it("reports unavailable database without calling Redis unnecessarily", async () => {
    const result = await checkSystemHealth(
      fakePrisma({ queryRawOk: false }) as never,
      {
        redisConfigured: true,
        pingRedis: vi.fn(async () => true),
      }
    );
    expect(result.ok).toBe(false);
    expect(result.database).toBe("unavailable");
  });

  it("fails overall when Redis is configured but unreachable, even if the database is fine", async () => {
    const result = await checkSystemHealth(fakePrisma() as never, {
      redisConfigured: true,
      pingRedis: vi.fn(async () => false),
    });
    expect(result.ok).toBe(false);
    expect(result.redis).toBe("unavailable");
  });

  it("treats a throwing Redis ping as unavailable instead of propagating the error", async () => {
    const result = await checkSystemHealth(fakePrisma() as never, {
      redisConfigured: true,
      pingRedis: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.redis).toBe("unavailable");
  });

  it("surfaces the outbox backlog counts", async () => {
    const result = await checkSystemHealth(
      fakePrisma({ pending: 7, deadLetter: 2 }) as never,
      {
        redisConfigured: false,
        pingRedis: vi.fn(),
      }
    );
    expect(result.outbox).toEqual({ pending: 7, deadLetter: 2 });
  });
});
