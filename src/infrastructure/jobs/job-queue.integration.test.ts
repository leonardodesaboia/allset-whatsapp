import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { QueueEvents, Worker } from "bullmq";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getJobQueue, toBullMqJobId } from "./job-queue";
import { JOB_NAME } from "./job-names";

describe("BullMQ queue/worker delivery", () => {
  const execFileAsync = promisify(execFile);
  let containerId: string;
  let connection: IORedis;
  beforeAll(async () => {
    const started = await execFileAsync("docker", ["run", "--detach", "--rm", "--publish", "127.0.0.1::6379", "redis:7-alpine"]);
    containerId = started.stdout.trim();
    const mapped = await execFileAsync("docker", ["port", containerId, "6379/tcp"]);
    const port = Number(mapped.stdout.trim().split(":").at(-1));
    connection = new IORedis({ host: "127.0.0.1", port, maxRetriesPerRequest: null });
  }, 60_000);
  afterAll(async () => {
    if (connection) await connection.quit();
    if (containerId) await execFileAsync("docker", ["stop", containerId]);
  });

  it("delivers jobs under a colon-containing environment prefix and retries transient failures", async () => {
    const prefix = `allset:test:${randomUUID()}`;
    const queue = getJobQueue(JOB_NAME.MESSAGE_DISPATCH, connection, prefix);
    const events = new QueueEvents(JOB_NAME.MESSAGE_DISPATCH, { connection, prefix });
    let attempts = 0;
    const worker = new Worker(JOB_NAME.MESSAGE_DISPATCH, async () => {
      if (++attempts === 1) throw new Error("Temporary failure");
      return "delivered";
    }, { connection, prefix });
    try {
      await events.waitUntilReady();
      const jobId = toBullMqJobId("message-dispatch:audio:inbound-id");
      const job = await queue.add(JOB_NAME.MESSAGE_DISPATCH, {}, { jobId, backoff: { type: "fixed", delay: 20 } });
      expect(await job.waitUntilFinished(events, 10000)).toBe("delivered");
      expect(attempts).toBe(2);
      const duplicate = await queue.add(JOB_NAME.MESSAGE_DISPATCH, {}, { jobId });
      expect(duplicate.id).toBe(job.id);
      expect(await queue.getJobCounts("completed")).toMatchObject({ completed: 1 });
    } finally {
      await worker.close();
      await events.close();
      await queue.close();
    }
  });
});
