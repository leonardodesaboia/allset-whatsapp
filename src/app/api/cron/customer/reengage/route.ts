import { reengageSilentCustomerConversations } from "@/application/customer/reengage-silent-customer-conversations.usecase";
import { compareSecret } from "@/infrastructure/auth/compare-secret";
import { prisma } from "@/infrastructure/db/prisma-client";
import { logger } from "@/infrastructure/observability/logger";
import { env } from "@/env";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!compareSecret(env.CRON_SECRET, supplied)) return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const result = await reengageSilentCustomerConversations(prisma, { afterHours: env.CUSTOMER_REENGAGEMENT_AFTER_HOURS });
    if (result.reengaged > 0) await publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH, jobId: `customer-reminder-dispatch:${Date.now()}`, payload: {},
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error({ err: error }, "Falha ao reengajar conversas de clientes");
    return Response.json({ ok: false, error: "REENGAGEMENT_FAILED" }, { status: 500 });
  }
}
