FROM node:24-alpine AS base
RUN corepack enable pnpm

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-secret-not-valid-for-runtime \
    BETTER_AUTH_URL=http://localhost:3000 \
    EVOLUTION_WEBHOOK_SECRET=build-only-webhook-secret-not-valid-for-runtime \
    INTERNAL_JOB_SECRET=build-only-internal-job-secret-not-valid-for-runtime \
    CRON_SECRET=build-only-cron-secret-not-valid-for-runtime \
    pnpm build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema + migrations for `prisma migrate deploy` at startup
COPY --from=builder /app/prisma ./prisma

# Full node_modules for the Prisma CLI used by docker-entrypoint.sh at startup.
# pnpm's node_modules/prisma and node_modules/@prisma/* are symlinks into
# node_modules/.pnpm/<pkg>@<version>/..., so copying just those two folders
# leaves dangling symlinks in the runner stage — the .pnpm store itself has
# to come along too. Copying the whole tree is the simplest way to guarantee that.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The route checks both the authenticated application boundary and database
# readiness. INTERNAL_JOB_SECRET is required by env validation in production.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null --header="x-allset-job-secret: ${INTERNAL_JOB_SECRET}" http://127.0.0.1:3000/api/internal/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
