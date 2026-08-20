import { z } from "zod";

/**
 * Valor de placeholder publicado em `.env.example`. Como o comando de setup
 * documentado é `cp .env.example .env`, sem esta trava o app subiria assinando
 * sessões com um segredo que está versionado no repositório — qualquer pessoa
 * poderia forjar um cookie de sessão de admin. Rejeitamos o literal para
 * forçar a geração de um segredo real (ex.: `openssl rand -base64 32`).
 */
export const BETTER_AUTH_SECRET_PLACEHOLDER = "replace-with-32+-char-random-secret";

/** Variáveis opcionais podem permanecer vazias no template `.env.example`. */
function optionalEnv<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    schema.optional(),
  );
}

function positiveIntegerEnv(defaultValue: number) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().positive().max(168).default(defaultValue),
  );
}

const envSchema = z.object({
  // Aceita tanto "postgresql://" quanto "postgres://" — ambos os esquemas
  // são válidos para Postgres (usados por libpq, Prisma e por ferramentas
  // como Testcontainers, cujo `getConnectionUri()` emite "postgres://").
  DATABASE_URL: z.string().url().regex(/^postgres(ql)?:\/\//, {
    message: "Invalid string: must start with \"postgresql://\" or \"postgres://\"",
  }),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine((value) => value !== BETTER_AUTH_SECRET_PLACEHOLDER, {
      message:
        "não pode ser o valor de placeholder do .env.example (ele é público); " +
        "gere um segredo real, ex.: `openssl rand -base64 32`",
    }),
  BETTER_AUTH_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  E2E_DISABLE_AUTH_RATE_LIMIT: optionalEnv(
    z.literal("true").transform(() => true as const),
  ),
  EVOLUTION_BASE_URL: optionalEnv(z.string().url()),
  EVOLUTION_API_KEY: optionalEnv(z.string().min(1)),
  EVOLUTION_INSTANCE: optionalEnv(z.string().min(1)),
  EVOLUTION_WEBHOOK_SECRET: optionalEnv(z.string().min(32)),
  INTERNAL_JOB_SECRET: optionalEnv(z.string().min(32)),
  CRON_SECRET: optionalEnv(z.string().min(32)),
  OPENAI_API_KEY: optionalEnv(z.string().min(1)),
  REDIS_URL: optionalEnv(z.string().url()),
  JOB_QUEUE_PREFIX: z.string().trim().min(1).max(64).default("allset:development"),
  WORKER_CONCURRENCY_MESSAGE_DISPATCH: positiveIntegerEnv(3),
  WORKER_CONCURRENCY_RECEIVED_AUDIO: positiveIntegerEnv(2),
  RECRUITMENT_REENGAGEMENT_AFTER_HOURS: positiveIntegerEnv(24),
  RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS: positiveIntegerEnv(2),
  OPPORTUNITY_EXPIRY_HOURS: positiveIntegerEnv(4),
  MESSAGING_DEFAULT_PROVIDER: z.string().trim().min(1).max(64).default("evolution"),
  // Storage S3-compatível (MinIO local ou AWS S3 em produção).
  // Todas as cinco variáveis abaixo devem ser definidas juntas; deixar vazias
  // ativa o provider local de desenvolvimento (não funciona com Evolution em prod).
  S3_ENDPOINT: optionalEnv(z.string().url()),
  S3_BUCKET: optionalEnv(z.string().min(1).max(63)),
  S3_REGION: optionalEnv(z.string().min(1).max(63)),
  S3_ACCESS_KEY_ID: optionalEnv(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optionalEnv(z.string().min(1)),
  // URL pública do MinIO (quando o endpoint interno difere do URL acessível externamente).
  S3_PUBLIC_URL: optionalEnv(z.string().url()),
}).superRefine((value, context) => {
  if (value.E2E_DISABLE_AUTH_RATE_LIMIT) {
    const hostname = new URL(value.BETTER_AUTH_URL).hostname;
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopbackHosts.has(hostname)) {
      context.addIssue({
        code: "custom",
        path: ["E2E_DISABLE_AUTH_RATE_LIMIT"],
        message: "só pode ser habilitado pelo harness E2E em uma origem loopback",
      });
    }
  }

  if (value.NODE_ENV !== "production") return;
  for (const key of ["EVOLUTION_WEBHOOK_SECRET", "INTERNAL_JOB_SECRET", "CRON_SECRET"] as const) {
    if (!value[key]) context.addIssue({ code: "custom", path: [key], message: "é obrigatório em produção" });
  }
});

export type Env = z.infer<typeof envSchema>;

const BUILD_DATABASE_URL = "postgresql://build:build@localhost:5432/build";
const BUILD_AUTH_SECRET = "build-only-secret-not-valid-for-runtime";
const BUILD_AUTH_URL = "http://localhost:3000";
const BUILD_EVOLUTION_WEBHOOK_SECRET = "build-only-webhook-secret-not-valid-for-runtime";
const BUILD_INTERNAL_JOB_SECRET = "build-only-internal-job-secret-not-valid-for-runtime";
const BUILD_CRON_SECRET = "build-only-cron-secret-not-valid-for-runtime";

/**
 * Route handlers are evaluated while `next build` collects route metadata.
 * At that moment production secrets deliberately are not available in CI.
 * These values exist only in the build process; `next start` evaluates this
 * module again without NEXT_PHASE and therefore keeps the strict validation.
 */
export function sourceForModuleEvaluation(source: Record<string, string | undefined>): Record<string, string | undefined> {
  if (source.NEXT_PHASE !== "phase-production-build") return source;
  return {
    ...source,
    DATABASE_URL: source.DATABASE_URL ?? BUILD_DATABASE_URL,
    BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET ?? BUILD_AUTH_SECRET,
    BETTER_AUTH_URL: source.BETTER_AUTH_URL ?? BUILD_AUTH_URL,
    EVOLUTION_WEBHOOK_SECRET: source.EVOLUTION_WEBHOOK_SECRET ?? BUILD_EVOLUTION_WEBHOOK_SECRET,
    INTERNAL_JOB_SECRET: source.INTERNAL_JOB_SECRET ?? BUILD_INTERNAL_JOB_SECRET,
    CRON_SECRET: source.CRON_SECRET ?? BUILD_CRON_SECRET,
  };
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Variáveis de ambiente inválidas: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export const env: Env = parseEnv(sourceForModuleEvaluation(process.env));
