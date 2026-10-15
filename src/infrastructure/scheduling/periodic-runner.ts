interface PeriodicTask { name: string; intervalMs: number; run: () => Promise<unknown>; }

/** Each task runs independently, with at most one active invocation in this process. */
export function startPeriodicTasks(tasks: PeriodicTask[], onError: (name: string, error: unknown) => void): () => void {
  let stopped = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const task of tasks) {
    let inFlight = false;
    const tick = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try { await task.run(); } catch (error) { onError(task.name, error); }
      finally { inFlight = false; }
    };
    const initial = setTimeout(() => { void tick(); }, 0);
    const interval = setInterval(() => { void tick(); }, task.intervalMs);
    initial.unref?.(); interval.unref?.();
    timers.push(initial, interval);
  }
  return () => { stopped = true; for (const timer of timers) clearTimeout(timer); };
}
