ALTER TABLE "CustomerBookingConversation" ADD COLUMN "misunderstandingCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CustomerBookingConversation" ADD COLUMN "misunderstandingState" TEXT;
