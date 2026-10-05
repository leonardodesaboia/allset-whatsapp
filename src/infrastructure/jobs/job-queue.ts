import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import type IORedis from "ioredis";
import type { JobName } from "./job-names";
import type { JobPayloadMap } from "./job-payloads";

const queues = new Map<string, Queue>();

/** BullMQ reserves ':' in custom IDs. Hashing preserves stable deduplication. */
export function toBullMqJobId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export function getJobQueue<N extends JobName>(
  name: N,
  connection: IORedis,
  prefix: string,
): Queue<JobPayloadMap[N]> {
  const queueName = `${prefix}:${name}`;
  const existing = queues.get(queueName);
  if (existing) return existing as Queue<JobPayloadMap[N]>;

  const queue = new Queue<JobPayloadMap[N]>(name, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  });
  queues.set(queueName, queue);
  return queue;
}
