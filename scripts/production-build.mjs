import { spawnSync } from "node:child_process";

/**
 * Route handlers are evaluated while `next build` collects metadata. They
 * validate the same operational secrets required at runtime, but the build
 * environment deliberately has no access to those secrets. Supply harmless
 * placeholders only for this child process. `next start` does not use this
 * script and remains protected by the strict validation in src/env.ts.
 *
 * Real values supplied by CI or a deploy platform always take precedence.
 */
const buildOnlyEnvironment = {
  EVOLUTION_WEBHOOK_SECRET: "build-only-webhook-secret-not-valid-for-runtime",
  INTERNAL_JOB_SECRET: "build-only-internal-job-secret-not-valid-for-runtime",
  CRON_SECRET: "build-only-cron-secret-not-valid-for-runtime",
};

const extraArguments = process.argv.slice(2);
if (extraArguments[0] === "--") extraArguments.shift();

const result = spawnSync("next", ["build", ...extraArguments], {
  env: { ...buildOnlyEnvironment, ...process.env },
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
