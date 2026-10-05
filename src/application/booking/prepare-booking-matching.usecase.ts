import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { DomainError } from "../../domain/shared/domain-error";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

const inputSchema = z.object({
  bookingId: z.string().uuid(),
  neighborhood: z.string().trim().min(2).max(120),
  professionalPaymentCents: z.number().int().positive().max(10_000_000),
  actor: z.string().trim().min(1).max(160),
});

export async function prepareBookingMatching(
  prisma: PrismaClient,
  rawInput: z.input<typeof inputSchema>,
) {
  const input = inputSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: input.bookingId },
      include: { opportunities: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!booking) throw new DomainError("Agendamento não encontrado.", "BOOKING_NOT_FOUND");
    const editable = booking.status === "DRAFT" || booking.status === "PAID"
      || (booking.status === "REVIEW_REQUIRED" && booking.opportunities[0]?.status === "EXPIRED");
    if (!editable) throw new DomainError("Este pedido não pode ter os dados da oportunidade alterados nesta etapa.", "BOOKING_NOT_EDITABLE");
    const updated = await tx.booking.updateMany({
      where: { id: booking.id, version: booking.version, status: booking.status },
      data: {
        neighborhood: input.neighborhood,
        professionalPaymentCents: input.professionalPaymentCents,
        version: { increment: 1 },
      },
    });
    if (!updated.count) throw new DomainError("O pedido foi alterado. Atualize o painel e tente novamente.", "BOOKING_CONFLICT");
    await recordAuditLog(tx, {
      actor: input.actor, action: "BOOKING_MATCHING_PREPARED", entityType: "Booking", entityId: booking.id,
      metadata: { neighborhood: input.neighborhood, professionalPaymentCents: input.professionalPaymentCents },
    });
    return { bookingId: booking.id };
  });
}
