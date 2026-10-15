import { env } from "@/env";
import { normalizeWhatsMiauWebhook } from "@/infrastructure/messaging/whatsmiau-webhook";
import { handleMessagingWebhook } from "../../webhook-handler";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleMessagingWebhook(request, { provider: "whatsmiau", secret: env.WHATSMIAU_WEBHOOK_SECRET, normalize: normalizeWhatsMiauWebhook });
}
