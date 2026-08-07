import { expireOpportunities } from "@/application/marketplace/expire-opportunities.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { env } from "@/env";

export const runtime = "nodejs";

/** Vercel Cron adapter. Keeps marketplace policy in the application use case. */
export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  const result = await expireOpportunities(prisma);
  return Response.json({ ok: true, ...result });
}
