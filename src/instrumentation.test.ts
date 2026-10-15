import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";
const start = vi.hoisted(() => vi.fn());
vi.mock("./infrastructure/scheduling/internal-scheduler", () => ({ startInternalScheduler: start }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Node instrumentation", () => {
  it.each([
    { NEXT_RUNTIME: "edge", NODE_ENV: "production" },
    { NEXT_RUNTIME: "nodejs", NODE_ENV: "production", REDIS_URL: "redis://localhost" },
    { NEXT_RUNTIME: "nodejs", NODE_ENV: "production", INTERNAL_SCHEDULER_ENABLED: "false" },
    { NEXT_RUNTIME: "nodejs", NODE_ENV: "production", NEXT_PHASE: "phase-production-build" },
    { NEXT_RUNTIME: "nodejs", NODE_ENV: "test" },
  ])("does not register in %j", async (config) => {
    for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
    await register(); expect(start).not.toHaveBeenCalled();
  });
  it("registers the Node production scheduler", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs"); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("REDIS_URL", "");
    await register(); expect(start).toHaveBeenCalledTimes(1);
  });
});
