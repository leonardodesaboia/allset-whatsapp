import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// These suites create disposable databases/queues and use mock messaging.
// Fixture URLs only apply to the child process; the project's .env is untouched.
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)),
  "run",
  "src/application/messaging/whatsapp-flow.integration.test.ts",
  "src/infrastructure/jobs/job-queue.integration.test.ts",
  "src/infrastructure/messaging/evolution-webhook.test.ts",
  "--maxWorkers=1",
  "--testTimeout=60000",
], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    BETTER_AUTH_URL: "http://localhost:3000",
    S3_PUBLIC_URL: "http://localhost:9000",
    MESSAGING_DEFAULT_PROVIDER: "mock",
    REDIS_URL: "",
  },
});
if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
