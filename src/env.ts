import { z } from "zod";

/**
 * Valor de placeholder publicado em `.env.example`. Como o comando de setup
 * documentado é `cp .env.example .env`, sem esta trava o app subiria assinando
 * sessões com um segredo que está versionado no repositório — qualquer pessoa
 * poderia forjar um cookie de sessão de admin. Rejeitamos o literal para
 * forçar a geração de um segredo real (ex.: `openssl rand -base64 32`).
 */
export const BETTER_AUTH_SECRET_PLACEHOLDER = "replace-with-32+-char-random-secret";

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
