ALTER TYPE "RecruitmentConversationState" ADD VALUE 'PROPOSAL_CONSENT';
ALTER TYPE "OutboundMessageStatus" ADD VALUE 'CANCELLED';
ALTER TABLE "RecruitmentLead" ADD COLUMN "proposalsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "ServiceOpportunity" ALTER COLUMN "paymentCents" DROP NOT NULL;
ALTER TABLE "Booking" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "OutboxMessage" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "MessagingDispatchThrottle" (
  "provider" TEXT NOT NULL,
  "nextSendAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessagingDispatchThrottle_pkey" PRIMARY KEY ("provider")
);
