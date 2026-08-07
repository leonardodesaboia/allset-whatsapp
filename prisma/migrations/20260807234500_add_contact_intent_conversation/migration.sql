-- CreateEnum
CREATE TYPE "ContactIntentConversationState" AS ENUM ('CHOOSING_INTENT', 'CUSTOMER', 'PROFESSIONAL', 'PAUSED');

-- CreateTable
CREATE TABLE "ContactIntentConversation" (
  "id" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "state" "ContactIntentConversationState" NOT NULL DEFAULT 'CHOOSING_INTENT',
  "lastInboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContactIntentConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactIntentConversation_phoneE164_key" ON "ContactIntentConversation"("phoneE164");
CREATE INDEX "ContactIntentConversation_state_lastInboundAt_idx" ON "ContactIntentConversation"("state", "lastInboundAt");
