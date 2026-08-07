ALTER TABLE "ReceivedAudio" ADD COLUMN "transcriptionLeaseUntil" TIMESTAMP(3);
CREATE INDEX "ReceivedAudio_transcriptionLeaseUntil_idx" ON "ReceivedAudio"("transcriptionLeaseUntil");
