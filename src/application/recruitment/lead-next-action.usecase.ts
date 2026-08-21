import type { LeadReminder, PrismaClient, RecruitmentLead } from "@prisma/client";
import { ok, type Result } from "../../domain/shared/result";
import type { DomainError } from "../../domain/shared/domain-error";

export async function setNextAction(
  prisma: PrismaClient,
  input: { leadId: string; actor: string; nextAction: string | null; nextActionAt?: Date | null },
): Promise<Result<RecruitmentLead, DomainError>> {
  return ok(
    await prisma.recruitmentLead.update({
      where: { id: input.leadId },
      data: {
        nextAction: input.nextAction,
        ...(input.nextActionAt !== undefined ? { nextActionAt: input.nextActionAt } : {}),
      },
    }),
  );
}

export async function createReminder(
  prisma: PrismaClient,
  input: { leadId: string; createdBy: string; text: string; dueAt: Date },
): Promise<Result<LeadReminder, DomainError>> {
  return prisma.$transaction(async (tx) => {
    const reminder = await tx.leadReminder.create({ data: input });
    await tx.leadEvent.create({
      data: { leadId: input.leadId, type: "REMINDER_CREATED", description: `Lembrete: ${input.text}`, actor: input.createdBy },
    });
    return ok(reminder);
  });
}

export async function completeReminder(
  prisma: PrismaClient,
  input: { reminderId: string },
): Promise<Result<LeadReminder, DomainError>> {
  return ok(await prisma.leadReminder.update({ where: { id: input.reminderId }, data: { doneAt: new Date() } }));
}
