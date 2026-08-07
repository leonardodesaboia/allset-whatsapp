import type { Money } from "../shared/money";

export type ChargeStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED";

export interface ChargeRequest {
  idempotencyKey: string;
  bookingId: string;
  amount: Money;
  description: string;
}

export interface ChargeResult {
  externalId: string;
  status: ChargeStatus;
}

export interface PaymentProvider {
  createCharge(request: ChargeRequest): Promise<ChargeResult>;
  getChargeStatus(externalId: string): Promise<ChargeStatus>;
  refund(externalId: string, amount: Money): Promise<void>;
}
