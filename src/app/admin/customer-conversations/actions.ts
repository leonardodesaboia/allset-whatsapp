"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/infrastructure/auth/auth";
import { prisma } from "@/infrastructure/db/prisma-client";
import {
  controlCustomerConversation,
  resumeCustomerBookingConversation,
} from "@/application/customer/customer-booking-conversation.usecase";
import { publishJobSafe } from "@/infrastructure/jobs/publish-job";
import { JOB_NAME } from "@/infrastructure/jobs/job-names";

const schema = z.object({
  conversationId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  action: z.enum(["resume", "pause", "step", "restart", "close"]),
  step: z.string().optional(),
});

export async function controlCustomerConversationAction(
  rawInput: z.input<typeof schema>
) {
  const session = await auth.api.getSession({ headers: await headers() });
  const admin = session?.user.email
    ? await prisma.user.findFirst({
        where: { email: session.user.email, role: "ADMIN" },
        select: { email: true },
      })
    : null;
  if (!admin?.email)
    return { ok: false as const, error: "Sessão expirada ou sem permissão." };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success)
    return { ok: false as const, error: "Dados da ação inválidos." };
  const input = { ...parsed.data, actor: admin.email };
  try {
    const result =
      input.action === "resume"
        ? await resumeCustomerBookingConversation(prisma, input)
        : await controlCustomerConversation(prisma, input);
    if (!result.ok) return { ok: false as const, error: result.error };
    publishJobSafe({
      name: JOB_NAME.MESSAGE_DISPATCH,
      jobId: `message-dispatch:drain:${Math.floor(Date.now() / 5000)}`,
      payload: {},
    }).catch(() => undefined);
    revalidatePath("/admin/customer-conversations");
    revalidatePath(`/admin/customer-conversations/${input.conversationId}`);
    revalidatePath("/admin/bookings");
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      error: "Não foi possível alterar a conversa. Atualize e tente novamente.",
    };
  }
}
