-- CreateEnum
CREATE TYPE "RecruitmentConversationState" AS ENUM ('INTRODUCTION', 'CHANNEL_PREFERENCE', 'NAME', 'NEIGHBORHOOD', 'PROFESSIONAL_EXPERIENCE', 'EXPERIENCE_DURATION', 'INFORMAL_EXPERIENCE', 'SERVICE_AREA', 'AVAILABILITY', 'MANUAL_REVIEW', 'PAUSED', 'COMPLETED');

-- CreateTable
CREATE TABLE "RecruitmentConversation" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "state" "RecruitmentConversationState" NOT NULL DEFAULT 'INTRODUCTION',
    "lastQuestionKey" TEXT,
    "misunderstandingCount" INTEGER NOT NULL DEFAULT 0,
    "automationPausedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentConversation_leadId_key" ON "RecruitmentConversation"("leadId");
CREATE INDEX "RecruitmentConversation_state_idx" ON "RecruitmentConversation"("state");
ALTER TABLE "RecruitmentConversation" ADD CONSTRAINT "RecruitmentConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
