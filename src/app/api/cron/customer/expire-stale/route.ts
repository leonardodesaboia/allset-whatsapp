import { expireStaleBookings } from "@/application/customer/expire-stale-bookings.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { env } from "@/env";
import { logger } from "@/infrastructure/observability/logger";

export const runtime = "nodejs";

/** Cron adapter mantido por compatibilidade: não há mais lembrete nem cancelamento por pagamento. */
export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const result = await expireStaleBookings(prisma);
    if (result.errors.length) {
      for (const { bookingId, error } of result.errors) {
        logger.error({ err: error, bookingId }, "Falha ao processar stale booking");
      }
    }
    return Response.json({ ok: true, ...result, errors: result.errors.length });
  } catch (error) {
    logger.error({ err: error }, "Falha no cron de expiração de bookings");
    return Response.json({ ok: false, error: "STALE_BOOKING_EXPIRY_FAILED" }, { status: 500 });
  }
}
