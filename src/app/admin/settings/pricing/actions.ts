"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";

const tierSchema = z.object({
  label: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(500),
  priceCents: z.number().int().positive().max(10_000_000),
  durationMinutes: z.number().int().min(30).max(12 * 60),
});

async function isAdmin(): Promise<boolean> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user.email) return false;
  return Boolean(await prisma.user.findFirst({ where: { email: session.user.email, role: "ADMIN" }, select: { id: true } }));
}

export async function createPricingTierAction(input: z.infer<typeof tierSchema>) {
  if (!await isAdmin()) return { ok: false as const, error: "Sessão expirada ou sem permissão." };
  const data = tierSchema.safeParse(input);
  if (!data.success) return { ok: false as const, error: "Revise as informações da faixa." };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.serviceDefinition.upsert({
        where: { code: "LIMPEZA_RESIDENCIAL_COMPLETA" },
        create: { code: "LIMPEZA_RESIDENCIAL_COMPLETA", name: "Limpeza residencial completa", isActive: true },
        update: { isActive: true },
      });
      const last = await tx.propertyPricingTier.aggregate({ _max: { sortOrder: true } });
      await tx.propertyPricingTier.create({
        data: {
          label: data.data.label,
          characteristics: { description: data.data.description },
          priceCents: data.data.priceCents,
          durationMinutes: data.data.durationMinutes,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    });
    revalidatePath("/admin/settings/pricing");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "Já existe uma faixa com este nome ou não foi possível salvá-la." };
  }
}

export async function setPricingTierActiveAction(id: string, isActive: boolean) {
  if (!await isAdmin()) return { ok: false as const, error: "Sessão expirada ou sem permissão." };
  if (!z.string().uuid().safeParse(id).success || typeof isActive !== "boolean") return { ok: false as const, error: "Faixa inválida." };
  await prisma.propertyPricingTier.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin/settings/pricing");
  return { ok: true as const };
}
