import type { PrismaClient } from "@prisma/client";
import { env } from "../../env";
import { prisma } from "../db/prisma-client";
import { logger } from "../observability/logger";
import { drainOutbox } from "../messaging/drain-outbox";
import { createMessagingGatewayRegistry } from "../messaging/messaging-runtime";
import { processRuntimeReceivedAudio } from "../messaging/received-audio-runtime";
import { reengageSilentConversations } from "../../application/recruitment/reengage-silent-conversations.usecase";
import { reengageSilentCustomerConversations } from "../../application/customer/reengage-silent-customer-conversations.usecase";
import { expireStaleBookings } from "../../application/customer/expire-stale-bookings.usecase";
import { expireOpportunities } from "../../application/marketplace/expire-opportunities.usecase";
import { startPeriodicTasks } from "./periodic-runner";
import { withMaintenanceLock } from "./postgres-maintenance-lock";
import { resolveInternalSchedulerStatus } from "./internal-scheduler-config";

const hour = 60 * 60 * 1000;

function maintenanceTask(database: PrismaClient) {
  const jobs = [
    { name: "recruitment/reengage", intervalMs: 24 * hour, run: () => reengageSilentConversations(database, { afterHours: env.RECRUITMENT_REENGAGEMENT_AFTER_HOURS, maximumAttempts: env.RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS }) },
    { name: "marketplace/expire", intervalMs: hour, run: () => expireOpportunities(database) },
    { name: "customer/expire-stale", intervalMs: hour, run: async () => {
      const result = await expireStaleBookings(database);
      for (const failure of result.errors) logger.error({ bookingId: failure.bookingId, err: failure.error }, "Scheduled booking expiry failed");
      return result;
    } },
    { name: "customer/reengage", intervalMs: hour, run: () => reengageSilentCustomerConversations(database, { afterHours: env.CUSTOMER_REENGAGEMENT_AFTER_HOURS }) },
  ];
  const nextRun = new Map<string, number>();
  return async () => {
    await withMaintenanceLock(database, async () => {
      for (const job of jobs) {
        if (Date.now() < (nextRun.get(job.name) ?? 0)) continue;
        try {
          const result = await job.run();
          nextRun.set(job.name, Date.now() + job.intervalMs);
          logger.info({ task: job.name, result }, "Scheduled maintenance completed");
        } catch (err) { logger.error({ task: job.name, err }, "Scheduled maintenance failed; retry next tick"); }
      }
    });
  };
}

export function startInternalScheduler() {
  const state = globalThis as typeof globalThis & { allsetInternalScheduler?: () => void };
  if (state.allsetInternalScheduler || !resolveInternalSchedulerStatus(env).enabled) return;
  const tasks = [
    { name: "messaging/dispatch", intervalMs: 15_000, run: () => drainOutbox(prisma, createMessagingGatewayRegistry(), { actor: "system:internal-scheduler", limit: 20 }) },
    { name: "maintenance", intervalMs: 60_000, run: maintenanceTask(prisma) },
  ];
  if (env.OPENAI_API_KEY) tasks.push({ name: "messaging/download-audio", intervalMs: 30_000, run: async () => {
    const results = await processRuntimeReceivedAudio(prisma, { limit: 10 });
    for (const result of results) if (!result.ok) logger.warn(result, "Scheduled audio processing failed");
  } });
  else logger.warn({ task: "messaging/download-audio" }, "Audio recovery disabled: OPENAI_API_KEY missing");
  state.allsetInternalScheduler = startPeriodicTasks(tasks, (task, err) => logger.error({ task, err }, "Internal scheduler tick failed"));
  logger.info({ tasks: tasks.map(({ name, intervalMs }) => ({ name, intervalMs })) }, "Internal scheduler started; external crontab is not required");
}
