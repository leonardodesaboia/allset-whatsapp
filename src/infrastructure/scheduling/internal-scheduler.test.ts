import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startInternalScheduler } from "./internal-scheduler";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>, start: vi.fn(), drain: vi.fn(), audio: vi.fn(), lock: vi.fn(), recruitment: vi.fn(), marketplace: vi.fn(), stale: vi.fn(), customer: vi.fn(),
}));
vi.mock("../../env", () => ({ env: mocks.env }));
vi.mock("../db/prisma-client", () => ({ prisma: {} }));
vi.mock("../observability/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../messaging/drain-outbox", () => ({ drainOutbox: mocks.drain }));
vi.mock("../messaging/messaging-runtime", () => ({ createMessagingGatewayRegistry: () => ({}) }));
vi.mock("../messaging/received-audio-runtime", () => ({ processRuntimeReceivedAudio: mocks.audio }));
vi.mock("./periodic-runner", () => ({ startPeriodicTasks: mocks.start }));
vi.mock("./postgres-maintenance-lock", () => ({ withMaintenanceLock: mocks.lock }));
vi.mock("../../application/recruitment/reengage-silent-conversations.usecase", () => ({ reengageSilentConversations: mocks.recruitment }));
vi.mock("../../application/marketplace/expire-opportunities.usecase", () => ({ expireOpportunities: mocks.marketplace }));
vi.mock("../../application/customer/expire-stale-bookings.usecase", () => ({ expireStaleBookings: mocks.stale }));
vi.mock("../../application/customer/reengage-silent-customer-conversations.usecase", () => ({ reengageSilentCustomerConversations: mocks.customer }));
type Task = { name: string; intervalMs: number; run: () => Promise<unknown> };
const state = globalThis as typeof globalThis & { allsetInternalScheduler?: () => void };
beforeEach(() => {
  vi.resetAllMocks(); delete state.allsetInternalScheduler;
  Object.assign(mocks.env, { NODE_ENV: "production", INTERNAL_SCHEDULER_ENABLED: undefined, REDIS_URL: undefined, OPENAI_API_KEY: "test" });
  mocks.start.mockReturnValue(vi.fn()); mocks.audio.mockResolvedValue([]); mocks.stale.mockResolvedValue({ errors: [] });
  mocks.lock.mockImplementation(async (_db, run) => { await run(); return true; });
});
afterEach(() => { delete state.allsetInternalScheduler; vi.useRealTimers(); });
describe("internal scheduler wiring", () => {
  it("starts only once with bounded dispatch, audio recovery and maintenance", async () => {
    startInternalScheduler(); startInternalScheduler();
    expect(mocks.start).toHaveBeenCalledTimes(1);
    const tasks = mocks.start.mock.calls[0]![0] as Task[];
    expect(tasks.map(({ name, intervalMs }) => ({ name, intervalMs }))).toEqual([
      { name: "messaging/dispatch", intervalMs: 15000 }, { name: "maintenance", intervalMs: 60000 }, { name: "messaging/download-audio", intervalMs: 30000 },
    ]);
    await tasks.find((task) => task.name === "messaging/dispatch")!.run();
    expect(mocks.drain).toHaveBeenCalledWith(expect.anything(), expect.anything(), { actor: "system:internal-scheduler", limit: 20 });
    await tasks.find((task) => task.name === "messaging/download-audio")!.run();
    expect(mocks.audio).toHaveBeenCalledWith(expect.anything(), { limit: 10 });
  });
  it.each([{ REDIS_URL: "redis://localhost" }, { INTERNAL_SCHEDULER_ENABLED: false }, { NODE_ENV: "test" }])("does not start with %j", (config) => {
    Object.assign(mocks.env, config); startInternalScheduler(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("permits explicit development opt-in and disables audio alone without OpenAI", () => {
    Object.assign(mocks.env, { NODE_ENV: "development", INTERNAL_SCHEDULER_ENABLED: true, OPENAI_API_KEY: undefined });
    startInternalScheduler(); expect(mocks.start.mock.calls[0]![0]).toHaveLength(2);
  });
  it("coordinates maintenance and retains daily/hourly schedules without overlap", async () => {
    vi.useFakeTimers(); startInternalScheduler();
    const task = (mocks.start.mock.calls[0]![0] as Task[]).find((task) => task.name === "maintenance")!;
    await task.run(); await task.run();
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(mocks.recruitment).toHaveBeenCalledTimes(1);
    expect(mocks.customer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3600000); await task.run();
    expect(mocks.recruitment).toHaveBeenCalledTimes(1);
    for (const run of [mocks.customer, mocks.stale, mocks.marketplace]) expect(run).toHaveBeenCalledTimes(2);
  });
  it("skips maintenance held by another instance and retries a failed job", async () => {
    startInternalScheduler();
    const task = (mocks.start.mock.calls[0]![0] as Task[]).find((task) => task.name === "maintenance")!;
    mocks.lock.mockResolvedValueOnce(false); await task.run(); expect(mocks.customer).not.toHaveBeenCalled();
    mocks.recruitment.mockRejectedValueOnce(new Error("temporary"));
    await task.run(); await task.run();
    expect(mocks.recruitment).toHaveBeenCalledTimes(2);
    expect(mocks.customer).toHaveBeenCalledTimes(1);
  });
});
