import { describe, expect, it, vi } from "vitest";
import { countStaleBookings } from "./stale-bookings-read-model";

describe("countStaleBookings", () => {
  it("counts bookings stuck in AWAITING_PAYMENT, REVIEW_REQUIRED or MATCHING past the cutoff", async () => {
    const count = vi.fn(async () => 3);
    const result = await countStaleBookings({ booking: { count } } as never, {
      staleAfterHours: 24,
      now: new Date("2026-12-10T12:00:00Z"),
    });

    expect(result).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: {
        status: { in: ["AWAITING_PAYMENT", "REVIEW_REQUIRED", "MATCHING"] },
        updatedAt: { lt: new Date("2026-12-09T12:00:00Z") },
      },
    });
  });

  it("defaults now to the current time when not provided", async () => {
    const count = vi.fn(
      async (_args: { where: { updatedAt: { lt: Date } } }) => 0
    );
    const before = Date.now();
    await countStaleBookings({ booking: { count } } as never, {
      staleAfterHours: 1,
    });
    const after = Date.now();

    const cutoffMs = count.mock.calls[0]![0].where.updatedAt.lt.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 60 * 60 * 1000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 60 * 60 * 1000);
  });
});
