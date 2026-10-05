-- An operational-test milestone is evidence and must be recorded at most once.
-- Preserve HELP history (which can happen more than once), while retaining the
-- earliest event if an old concurrent operation produced duplicate milestones.
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "testId", "type"
    ORDER BY "createdAt", "id"
  ) AS occurrence
  FROM "OperationalTestEvent"
  WHERE "type" <> 'HELP'
)
DELETE FROM "OperationalTestEvent" AS event
USING ranked
WHERE event."id" = ranked."id" AND ranked.occurrence > 1;

-- A partial index matches the domain rule without preventing repeated support
-- requests, and closes the read-then-write race at the database boundary.
CREATE UNIQUE INDEX "OperationalTestEvent_testId_type_once_key"
  ON "OperationalTestEvent"("testId", "type")
  WHERE "type" <> 'HELP';
