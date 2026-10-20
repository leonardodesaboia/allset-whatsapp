/** Mensagens automáticas do fluxo de cobrança retirado da plataforma. */
export function isRetiredPaymentMessage(idempotencyKey: string): boolean {
  return (
    idempotencyKey.startsWith("payment-reminder:") ||
    idempotencyKey.startsWith("payment-cancelled:") ||
    /^customer-booking:.*:(AWAITING_PAYMENT|awaiting-payment-follow-up):/.test(
      idempotencyKey
    )
  );
}
