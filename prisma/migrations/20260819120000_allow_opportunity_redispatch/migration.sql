-- An expired offer is part of the booking's operational history. Removing the
-- one-opportunity-per-booking constraint lets a later recovery create a fresh
-- offer (and fresh response tokens) without mutating that history.
DROP INDEX "ServiceOpportunity_bookingId_key";

CREATE INDEX "ServiceOpportunity_bookingId_idx" ON "ServiceOpportunity"("bookingId");
