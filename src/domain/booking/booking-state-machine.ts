import { err, ok, type Result } from "../shared/result";
import { DomainError } from "../shared/domain-error";
import type { BookingStatus } from "./booking-status";

export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT: ["COLLECTING_DATA", "CANCELLED"],
  COLLECTING_DATA: ["REVIEW_REQUIRED", "AWAITING_CUSTOMER_CONFIRMATION", "CANCELLED"],
  REVIEW_REQUIRED: ["AWAITING_CUSTOMER_CONFIRMATION", "CANCELLED"],
  AWAITING_CUSTOMER_CONFIRMATION: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  PAID: ["MATCHING", "REFUND_PENDING"],
  MATCHING: ["PROFESSIONAL_ASSIGNED", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_ASSIGNED: ["SCHEDULED", "MATCHING", "CANCELLED"],
  SCHEDULED: ["PROFESSIONAL_CONFIRMED", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_CONFIRMED: ["PROFESSIONAL_EN_ROUTE", "ISSUE_OPEN", "CANCELLED"],
  PROFESSIONAL_EN_ROUTE: ["IN_PROGRESS", "ISSUE_OPEN"],
  IN_PROGRESS: ["AWAITING_COMPLETION_CONFIRMATION", "ISSUE_OPEN"],
  AWAITING_COMPLETION_CONFIRMATION: ["COMPLETED", "ISSUE_OPEN"],
  COMPLETED: [],
  ISSUE_OPEN: ["CANCELLED", "SCHEDULED", "REFUND_PENDING", "COMPLETED"],
  CANCELLED: [],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
};

export function transitionBookingStatus(
  current: BookingStatus,
  target: BookingStatus,
): Result<BookingStatus, DomainError> {
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    return err(
      new DomainError(
        `Transição inválida de ${current} para ${target}`,
        "INVALID_BOOKING_TRANSITION",
      ),
    );
  }
  return ok(target);
}
