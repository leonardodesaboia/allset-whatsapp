import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
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

// Validação no startup apenas em modo não-teste
let envCached: Env | null = null;

export const env: Env = (() => {
  if (envCached) return envCached;
  if (process.env.NODE_ENV !== "test") {
    envCached = parseEnv(process.env);
    return envCached;
  }
  // Em teste, retorna um objeto vazio para permitir imports
  // O parseEnv será chamado explicitamente nos testes
  return {} as Env;
})();
