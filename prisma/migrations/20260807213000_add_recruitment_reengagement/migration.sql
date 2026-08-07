-- AlterTable
ALTER TABLE "RecruitmentConversation"
ADD COLUMN "lastReengagementAt" TIMESTAMP(3),
ADD COLUMN "reengagementCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "RecruitmentConversation_state_lastInboundAt_idx"
ON "RecruitmentConversation"("state", "lastInboundAt");
