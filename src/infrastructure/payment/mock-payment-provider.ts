import { randomUUID } from "node:crypto";
import type {
  ChargeRequest,
  ChargeResult,
  ChargeStatus,
  PaymentProvider,
} from "../../domain/ports/payment-provider";
import type { Money } from "../../domain/shared/money";

interface StoredCharge {
  externalId: string;
  status: ChargeStatus;
}

export class MockPaymentProvider implements PaymentProvider {
  private readonly byIdempotencyKey = new Map<string, StoredCharge>();
  private readonly byExternalId = new Map<string, StoredCharge>();

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    const existing = this.byIdempotencyKey.get(request.idempotencyKey);
    if (existing) {
      return existing;
    }
    const charge: StoredCharge = { externalId: randomUUID(), status: "PENDING" };
    this.byIdempotencyKey.set(request.idempotencyKey, charge);
    this.byExternalId.set(charge.externalId, charge);
    return charge;
  }

  async getChargeStatus(externalId: string): Promise<ChargeStatus> {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    return charge.status;
  }

  async refund(externalId: string, _amount: Money): Promise<void> {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    charge.status = "REFUNDED";
  }

  /** Helper exclusivo de teste/homologação: simula o webhook de confirmação. */
  simulateConfirmation(externalId: string): void {
    const charge = this.byExternalId.get(externalId);
    if (!charge) {
      throw new Error(`Cobrança ${externalId} não encontrada no MockPaymentProvider`);
    }
    charge.status = "PAID";
  }
}
