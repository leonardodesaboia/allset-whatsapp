ALTER TABLE "InboundMessage"
ADD COLUMN "mediaProcessingFailedAt" TIMESTAMP(3),
ADD COLUMN "mediaProcessingError" TEXT;

CREATE TABLE "MessagingProviderState" (
    "provider" TEXT NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "httpStatus" INTEGER,
    "leaseExpiresAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessagingProviderState_pkey" PRIMARY KEY ("provider")
);
