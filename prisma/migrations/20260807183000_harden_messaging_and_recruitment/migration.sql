-- AlterEnum
ALTER TYPE "OutboundMessageStatus" ADD VALUE 'DEAD_LETTER';

-- AlterTable
ALTER TABLE "InboundMessage" ADD COLUMN "processedAt" TIMESTAMP(3);
ALTER TABLE "OutboxMessage" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
ALTER TABLE "RecruitmentConversation" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock';

-- CreateIndex
CREATE INDEX "OutboxMessage_leaseExpiresAt_idx" ON "OutboxMessage"("leaseExpiresAt");
CREATE UNIQUE INDEX "RecruitmentLead_phoneE164_key" ON "RecruitmentLead"("phoneE164");

-- AddForeignKey
ALTER TABLE "RecruitmentLead" ADD CONSTRAINT "RecruitmentLead_referredByProfessionalId_fkey" FOREIGN KEY ("referredByProfessionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
