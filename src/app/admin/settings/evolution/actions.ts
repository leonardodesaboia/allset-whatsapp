"use server";

import { headers } from "next/headers";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { getMessagingIntegrationConfig } from "@/infrastructure/messaging/messaging-runtime";

export async function generateEvolutionQrCodeAction(): Promise<{ ok: true; code: string; pairingCode?: string } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const email = session?.user.email;
  if (!email || !await prisma.user.findFirst({ where: { email, role: "ADMIN" }, select: { id: true } })) {
    return { ok: false, error: "Sessão expirada ou sem permissão." };
  }
  const config = getMessagingIntegrationConfig();
  if (!config.baseUrl || !config.apiKey || !config.instance) {
    return { ok: false, error: "Integração WhatsApp não configurada." };
  }
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/, "")}/instance/connect/${encodeURIComponent(config.instance)}`,
      { headers: { apikey: config.apiKey }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    const data = await response.json() as { code?: string; base64?: string; pairingCode?: string; suspension_reason?: string };
    if (response.status === 423) return { ok: false, error: `Instância suspensa: ${data.suspension_reason ?? "motivo indisponível"}` };
    if (!response.ok) return { ok: false, error: "Não foi possível gerar o QR Code." };
    const code = data.base64 ?? data.code;
    return code ? { ok: true, code } : data.pairingCode ? { ok: true, code: "", pairingCode: data.pairingCode } : { ok: false, error: `${config.label} não retornou um QR Code.` };
  } catch {
    return { ok: false, error: "Não foi possível conectar ao WhatsApp." };
  }
}
