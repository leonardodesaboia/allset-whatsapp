"use server";

import { headers } from "next/headers";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import { env } from "@/env";

export async function generateEvolutionQrCodeAction(): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  const email = session?.user.email;
  if (!email || !await prisma.user.findFirst({ where: { email, role: "ADMIN" }, select: { id: true } })) {
    return { ok: false, error: "Sessão expirada ou sem permissão." };
  }
  if (!env.EVOLUTION_BASE_URL || !env.EVOLUTION_API_KEY || !env.EVOLUTION_INSTANCE) {
    return { ok: false, error: "Integração Evolution não configurada." };
  }
  try {
    const response = await fetch(
      `${env.EVOLUTION_BASE_URL.replace(/\/$/, "")}/instance/connect/${encodeURIComponent(env.EVOLUTION_INSTANCE)}`,
      { headers: { apikey: env.EVOLUTION_API_KEY }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) return { ok: false, error: "Não foi possível gerar o QR Code." };
    const data = await response.json() as { code?: string; base64?: string; pairingCode?: string };
    const code = data.base64 ?? data.code ?? data.pairingCode;
    return code ? { ok: true, code } : { ok: false, error: "A Evolution não retornou um QR Code." };
  } catch {
    return { ok: false, error: "Não foi possível conectar à Evolution." };
  }
}
