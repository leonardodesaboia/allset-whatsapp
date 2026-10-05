-- ReceivedAudio: index for audio worker lease queries
CREATE INDEX "ReceivedAudio_transcription_transcriptionLeaseUntil_idx"
  ON "ReceivedAudio"("transcription", "transcriptionLeaseUntil");

-- OutboxMessage: index for dispatch worker lease-expiry queries
CREATE INDEX "OutboxMessage_status_leaseExpiresAt_idx"
  ON "OutboxMessage"("status", "leaseExpiresAt");

-- LeadNote: compound index for soft-delete filtered queries
DROP INDEX "LeadNote_leadId_idx";
CREATE INDEX "LeadNote_leadId_deletedAt_idx"
  ON "LeadNote"("leadId", "deletedAt");

-- AuthVerification: index for identifier lookups and TTL cleanup
CREATE INDEX "AuthVerification_identifier_expiresAt_idx"
  ON "AuthVerification"("identifier", "expiresAt");

-- AuthSession: userId index + cascade on user deletion
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_userId_fkey";
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AuthUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AuthAccount: userId index + cascade on user deletion
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");
ALTER TABLE "AuthAccount" DROP CONSTRAINT "AuthAccount_userId_fkey";
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AuthUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
