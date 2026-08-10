import { describe, expect, it } from "vitest";
import { transitionBookingStatus, ALLOWED_TRANSITIONS } from "./booking-state-machine";
import { BOOKING_STATUSES, type BookingStatus } from "./booking-status";

describe("transitionBookingStatus", () => {
  it("permite todas as transições declaradas no mapa", () => {
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS) as [
      BookingStatus,
      BookingStatus[],
    ][]) {
      for (const to of targets) {
        const result = transitionBookingStatus(from, to);
        expect(result.ok, `${from} -> ${to} deveria ser permitido`).toBe(true);
      }
    }
  });

  it("rejeita uma transição não declarada (DRAFT -> COMPLETED)", () => {
    const result = transitionBookingStatus("DRAFT", "COMPLETED");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_BOOKING_TRANSITION");
    }
  });

  it("rejeita transição a partir de um estado terminal (COMPLETED -> IN_PROGRESS)", () => {
    const result = transitionBookingStatus("COMPLETED", "IN_PROGRESS");
    expect(result.ok).toBe(false);
  });

  it("todo status listado em BOOKING_STATUSES aparece no mapa de transições (nem que seja como terminal, com lista vazia)", () => {
    for (const status of BOOKING_STATUSES) {
      expect(Object.hasOwn(ALLOWED_TRANSITIONS, status)).toBe(true);
    }
  });
});
