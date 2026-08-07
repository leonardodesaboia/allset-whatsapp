import type { Booking, Prisma, PrismaClient } from "@prisma/client";
import { transitionBookingStatus } from "../../domain/booking/booking-state-machine";
import type { BookingStatus } from "../../domain/booking/booking-status";
import { DomainError } from "../../domain/shared/domain-error";
import { err, ok, type Result } from "../../domain/shared/result";
import { recordAuditLog } from "../audit/record-audit-log.usecase";

export interface TransitionBookingStatusInput {
  bookingId: string;
  targetStatus: BookingStatus;
  actor: string;
  reason?: string;
}

/**
 * Shared transactional variant for application flows that already own the
 * transaction (for example, a WhatsApp conversation). Keeping the transition
 * here prevents those flows from bypassing history, audit, and optimistic lock.
 */
export async function transitionBookingStatusInTransaction(
  tx: Prisma.TransactionClient,
  input: TransitionBookingStatusInput,
): Promise<Result<Booking, DomainError>> {
  const current = await tx.booking.findUnique({ where: { id: input.bookingId } });
  if (!current) {
    return err(new DomainError(`Booking ${input.bookingId} não encontrado`, "BOOKING_NOT_FOUND"));
  }

  const transition = transitionBookingStatus(current.status as BookingStatus, input.targetStatus);
  if (!transition.ok) return err(transition.error);

  const updateResult = await tx.booking.updateMany({
    where: { id: input.bookingId, status: current.status },
    data: { status: input.targetStatus, version: { increment: 1 } },
  });
  if (!updateResult.count) {
    return err(new DomainError(`Booking ${input.bookingId} foi alterado concorrentemente`, "BOOKING_CONCURRENT_MODIFICATION"));
  }

  await tx.bookingStatusHistory.create({
    data: {
      bookingId: input.bookingId,
      fromStatus: current.status,
      toStatus: input.targetStatus,
      actor: input.actor,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    },
  });
  await recordAuditLog(tx, {
    actor: input.actor,
    action: "BOOKING_STATUS_TRANSITION",
    entityType: "Booking",
    entityId: input.bookingId,
    metadata: { from: current.status, to: input.targetStatus, reason: input.reason },
  });

  return ok(await tx.booking.findUniqueOrThrow({ where: { id: input.bookingId } }));
}

export async function transitionBookingStatusUseCase(
  prisma: PrismaClient,
  input: TransitionBookingStatusInput,
): Promise<Result<Booking, DomainError>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return transitionBookingStatusInTransaction(tx, input);
  });
}
