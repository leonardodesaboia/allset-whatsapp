import { describe, expect, it } from "vitest";
import { isEligibleForReengagement } from "./reengagement-policy";

describe("isEligibleForReengagement", () => {
  const now = new Date("2026-08-07T15:00:00.000Z");
  const base = { state: "NAME", lastInboundAt: new Date("2026-08-06T14:00:00.000Z"), lastReengagementAt: null, reengagementCount: 0 };

  it("selects an active conversation silent for the configured period", () => {
    expect(isEligibleForReengagement(base, now, 24, 2)).toBe(true);
  });

  it("does not select paused, recent, cooled-down or exhausted conversations", () => {
    expect(isEligibleForReengagement({ ...base, state: "PAUSED" }, now, 24, 2)).toBe(false);
    expect(isEligibleForReengagement({ ...base, lastInboundAt: new Date("2026-08-07T14:00:00.000Z") }, now, 24, 2)).toBe(false);
    expect(isEligibleForReengagement({ ...base, lastReengagementAt: new Date("2026-08-07T14:30:00.000Z") }, now, 24, 2)).toBe(false);
    expect(isEligibleForReengagement({ ...base, reengagementCount: 2 }, now, 24, 2)).toBe(false);
  });
});
