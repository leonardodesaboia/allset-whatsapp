-- CreateTable
CREATE TABLE "QuestionAudioAsset" (
    "id" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    CONSTRAINT "QuestionAudioAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ReceivedAudio" (
    "id" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "transcription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReceivedAudio_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuestionAudioAsset_questionKey_version_key" ON "QuestionAudioAsset"("questionKey", "version");
CREATE INDEX "QuestionAudioAsset_questionKey_isActive_idx" ON "QuestionAudioAsset"("questionKey", "isActive");
CREATE UNIQUE INDEX "ReceivedAudio_inboundMessageId_key" ON "ReceivedAudio"("inboundMessageId");
ALTER TABLE "ReceivedAudio" ADD CONSTRAINT "ReceivedAudio_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "InboundMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
