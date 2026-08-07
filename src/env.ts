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
  EVOLUTION_BASE_URL: optionalEnv(z.string().url()),
  EVOLUTION_API_KEY: optionalEnv(z.string().min(1)),
  EVOLUTION_INSTANCE: optionalEnv(z.string().min(1)),
  EVOLUTION_WEBHOOK_SECRET: optionalEnv(z.string().min(32)),
  INTERNAL_JOB_SECRET: optionalEnv(z.string().min(32)),
  OPENAI_API_KEY: optionalEnv(z.string().min(1)),
  RECRUITMENT_REENGAGEMENT_AFTER_HOURS: positiveIntegerEnv(24),
  RECRUITMENT_REENGAGEMENT_MAX_ATTEMPTS: positiveIntegerEnv(2),
  OPPORTUNITY_EXPIRY_HOURS: positiveIntegerEnv(4),
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
});

export type Env = z.infer<typeof envSchema>;

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

export const env: Env = parseEnv(process.env);
