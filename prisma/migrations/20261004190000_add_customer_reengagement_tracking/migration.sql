ALTER TABLE "CustomerBookingConversation" ADD COLUMN "lastReengagementAt" TIMESTAMP(3);

-- Preserve reminders already queued before tracking was introduced.
UPDATE "CustomerBookingConversation" AS c
SET "lastReengagementAt" = (
  SELECT MAX(o."createdAt") FROM "OutboxMessage" AS o
  WHERE o."correlationId" = c.id
    AND o."idempotencyKey" LIKE 'customer-reengagement:%'
);
