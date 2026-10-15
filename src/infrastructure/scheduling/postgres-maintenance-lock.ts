import type { PrismaClient } from "@prisma/client";

/** A transaction-scoped lock is automatically released on error or disconnect.
 * It owns only coordination; application use cases keep their own transactions.
 * Maintenance is serial, so at most one extra connection per process is held. */
export async function withMaintenanceLock(database: PrismaClient, run: () => Promise<void>): Promise<boolean> {
  return database.$transaction(async (lock) => {
    const [result] = await lock.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(41827, 1) AS locked`;
    if (!result?.locked) return false;
    await run();
    return true;
  }, { maxWait: 5000, timeout: 120_000 });
}
