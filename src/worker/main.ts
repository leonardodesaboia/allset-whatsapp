import IORedis from "ioredis";
import { Worker, type Job } from "bullmq";
import { logger } from "@/infrastructure/observability/logger";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";
import { parseEnv, sourceForModuleEvaluation } from "@/env";
import { dispatchMessageProcessor } from "./processors/dispatch-message.processor";
import { processReceivedAudioProcessor } from "./processors/process-received-audio.processor";
import { expireOpportunityProcessor } from "./processors/expire-opportunity.processor";
import { reengageRecruitmentProcessor } from "./processors/reengage-recruitment.processor";

// Validate all env vars at startup — fail fast before accepting any jobs.
parseEnv(sourceForModuleEvaluation(process.env));

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  logger.error("REDIS_URL não configurado — worker não pode iniciar");
  process.exit(1);
}

const prefix = process.env.JOB_QUEUE_PREFIX ?? "allset:development";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on("error", (err) => {
  logger.error({ err }, "Erro na conexão Redis do worker");
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = (job: Job<any>) => Promise<void>;

const queues: Array<{ name: string; concurrency: number; processor: AnyProcessor }> = [
  {
    name: JOB_NAME.MESSAGE_DISPATCH,
    concurrency: Number(process.env.WORKER_CONCURRENCY_MESSAGE_DISPATCH ?? 3),
    processor: dispatchMessageProcessor,
  },
  {
    name: JOB_NAME.RECEIVED_AUDIO,
    concurrency: Number(process.env.WORKER_CONCURRENCY_RECEIVED_AUDIO ?? 2),
    processor: processReceivedAudioProcessor,
  },
  {
    name: JOB_NAME.OPPORTUNITY_EXPIRATION,
    concurrency: 5,
    processor: expireOpportunityProcessor,
  },
  {
    name: JOB_NAME.RECRUITMENT_REENGAGEMENT,
    concurrency: 2,
    processor: reengageRecruitmentProcessor,
  },
];

const workers = queues.map(({ name, concurrency, processor }) => {
  const queueName = `${prefix}:${name}`;
  const worker = new Worker(queueName, processor, { connection, concurrency });

  worker.on("completed", (job) => {
    logger.info({ jobName: name, jobId: job.id }, "Job concluído");
  });
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobName: name, jobId: job?.id, attempt: job?.attemptsMade }, "Job falhou");
  });
  worker.on("error", (error) => {
    logger.error({ err: error, jobName: name }, "Erro interno no worker");
  });

  return worker;
});

logger.info({ queues: queues.map((q) => q.name), prefix }, "AllSet worker iniciado");

async function shutdown() {
  logger.info("Encerrando worker...");
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  logger.info("Worker encerrado com sucesso");
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });
