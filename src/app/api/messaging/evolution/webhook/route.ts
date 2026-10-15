import { env } from "@/env";
import { normalizeEvolutionWebhook } from "@/infrastructure/messaging/evolution-webhook";
import { handleMessagingWebhook } from "../../webhook-handler";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleMessagingWebhook(request, { provider: "evolution", secret: env.EVOLUTION_WEBHOOK_SECRET, normalize: normalizeEvolutionWebhook });
}
