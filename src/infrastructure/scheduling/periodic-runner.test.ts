import { afterEach, describe, expect, it, vi } from "vitest";
import { startPeriodicTasks } from "./periodic-runner";

afterEach(() => vi.useRealTimers());
describe("periodic tasks", () => {
  it("runs on startup and at each interval, never overlaps a slow task", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const stop = startPeriodicTasks([{ name: "dispatch", intervalMs: 1000, run }], vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    finish(); await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it("recovers after errors and lets audio run while dispatch is slow", async () => {
    vi.useFakeTimers();
    const slow = vi.fn(() => new Promise<void>(() => {}));
    const audio = vi.fn().mockRejectedValueOnce(new Error("storage down")).mockResolvedValue(undefined);
    const error = vi.fn();
    const stop = startPeriodicTasks([{ name: "dispatch", intervalMs: 1000, run: slow }, { name: "audio", intervalMs: 1000, run: audio }], error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(audio).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith("audio", expect.any(Error));
    stop();
  });
});
