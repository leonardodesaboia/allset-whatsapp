import { betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { prisma } from "../db/prisma-client";
import { env } from "../../env";
import { logger } from "../observability/logger";

/**
 * Instância do Better Auth usada pelo Route Handler (`/api/auth/[...all]`)
 * e pelo layout protegido do dashboard admin (Task 10).
 *
 * Deliberadamente usa um modelo de autenticação separado
 * (AuthUser/AuthSession/AuthAccount/AuthVerification) do `User`/`AdminProfile`
 * de domínio (Task 3), para que sessão/credenciais não se acoplem a papéis
 * de negócio. O domínio referencia o usuário autenticado por e-mail (ou por
 * um futuro `authUserId`), nunca compartilhando a tabela.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 5,
  },
  // Os modelos do Better Auth vivem em tabelas próprias (Auth*), distintas
  // do `User` de domínio. `modelName` deve ser o nome do accessor gerado
  // pelo Prisma Client (camelCase do nome do model no schema.prisma).
  user: {
    modelName: "authUser",
  },
  session: {
    modelName: "authSession",
  },
  account: {
    modelName: "authAccount",
    fields: {
      // Nossa coluna se chama `passwordHash`, não `password`.
      password: "passwordHash",
    },
  },
  verification: {
    modelName: "authVerification",
  },
  hooks: {
    // O hook global `after` do Better Auth roda para TODO endpoint; não
    // aceita um array de {matcher, handler} no nível raiz (isso só existe
    // dentro de plugins). Filtramos o path manualmente dentro do handler.
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;

      const email = String(ctx.body?.email ?? "unknown");
      const returned = ctx.context.returned;
      const success = !isAPIError(returned);

      logger.info({ email, success }, "Tentativa de login admin");

      await prisma.auditLog.create({
        data: {
          actor: email,
          action: "ADMIN_LOGIN_ATTEMPT",
          entityType: "AuthUser",
          entityId: email,
          metadata: { success },
        },
      });
    }),
  },
});
