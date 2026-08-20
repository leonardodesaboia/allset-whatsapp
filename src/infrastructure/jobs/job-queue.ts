import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { JobName } from "./job-names";
import type { JobPayloadMap } from "./job-payloads";

const queues = new Map<string, Queue>();

export function getJobQueue<N extends JobName>(
  name: N,
  connection: IORedis,
  prefix: string,
): Queue<JobPayloadMap[N]> {
  const queueName = `${prefix}:${name}`;
  const existing = queues.get(queueName);
  if (existing) return existing as Queue<JobPayloadMap[N]>;

  const queue = new Queue<JobPayloadMap[N]>(queueName, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 200 },
      removeOnFail: false,
    },
  });
  queues.set(queueName, queue);
  return queue;
}
