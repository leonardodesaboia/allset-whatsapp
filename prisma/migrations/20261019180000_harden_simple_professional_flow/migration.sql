ALTER TABLE "OpportunityResponse" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- Retira endereços completos que o fluxo anterior copiou para o campo público.
UPDATE "ServiceOpportunity" opportunity
SET "neighborhood" = COALESCE(NULLIF(TRIM(booking."neighborhood"), ''), 'Bairro a confirmar'),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Booking" booking
WHERE opportunity."bookingId" = booking.id
  AND opportunity."neighborhood" = booking."addressLine1";

-- Cancela cobranças que ainda não saíram. Mensagens já enviadas ficam no histórico.
UPDATE "OutboxMessage"
SET status = 'CANCELLED', "leaseExpiresAt" = NULL,
    "lastError" = 'Cobrança pela plataforma desativada', "updatedAt" = CURRENT_TIMESTAMP
WHERE status IN ('PENDING', 'FAILED', 'SENDING')
  AND ("idempotencyKey" LIKE 'payment-reminder:%'
    OR "idempotencyKey" LIKE 'payment-cancelled:%'
    OR "idempotencyKey" ~ '^customer-booking:.*:(AWAITING_PAYMENT|awaiting-payment-follow-up):');

-- Pedidos antigos precisam da confirmação do contratante sob as novas condições.
WITH previous AS (
  SELECT id, status FROM "Booking" WHERE status IN ('AWAITING_PAYMENT', 'PAYMENT_FAILED') FOR UPDATE
), migrated AS (
  UPDATE "Booking" booking
  SET status = 'AWAITING_CUSTOMER_CONFIRMATION', "confirmedAt" = NULL,
      version = booking.version + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM previous WHERE booking.id = previous.id
  RETURNING booking.id, previous.status AS "fromStatus"
)
INSERT INTO "BookingStatusHistory" (id, "bookingId", "fromStatus", "toStatus", actor, reason, "createdAt")
SELECT gen_random_uuid()::text, id, "fromStatus", 'AWAITING_CUSTOMER_CONFIRMATION',
       'system:payment-flow-migration', 'Pagamento direto entre as partes; solicitar nova confirmação', CURRENT_TIMESTAMP
FROM migrated;

UPDATE "CustomerBookingConversation" conversation
SET state = CASE WHEN conversation.state = 'PAUSED' THEN 'PAUSED'::"CustomerBookingConversationState"
                 ELSE 'FINAL_CONFIRMATION'::"CustomerBookingConversationState" END,
    "lastQuestionKey" = 'FINAL_CONFIRMATION', version = conversation.version + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Booking" booking
WHERE conversation."bookingId" = booking.id
  AND booking.status = 'AWAITING_CUSTOMER_CONFIRMATION' AND booking."confirmedAt" IS NULL
  AND (conversation.state = 'AWAITING_PAYMENT'
    OR (conversation.state = 'PAUSED' AND conversation."lastQuestionKey" = 'AWAITING_PAYMENT'));
