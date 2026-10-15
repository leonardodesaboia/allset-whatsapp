export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.REDIS_URL || process.env.INTERNAL_SCHEDULER_ENABLED === "false") return;
  if (process.env.NODE_ENV !== "production" && process.env.INTERNAL_SCHEDULER_ENABLED !== "true") return;
  const { startInternalScheduler } = await import("./infrastructure/scheduling/internal-scheduler");
  startInternalScheduler();
}
