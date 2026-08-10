-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'QUOTED';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'QUOTE_ACCEPTED';

-- CreateEnum
CREATE TYPE "CustomerBookingConversationState" AS ENUM ('INTRODUCTION', 'NAME', 'PROPERTY_CHARACTERISTICS', 'SCHEDULE_DATE', 'SCHEDULE_TIME', 'QUOTE', 'QUOTE_ACCEPTANCE', 'ADDRESS', 'FINAL_CONFIRMATION', 'AWAITING_PAYMENT', 'MANUAL_REVIEW', 'PAUSED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "propertyPricingTierId" TEXT,
ADD COLUMN "propertyCharacteristics" JSONB,
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "addressReference" TEXT,
ADD COLUMN "customerNotes" TEXT,
ADD COLUMN "requestedAt" TIMESTAMP(3),
ADD COLUMN "quotedAt" TIMESTAMP(3),
ADD COLUMN "coverageValidatedAt" TIMESTAMP(3),
ADD COLUMN "outsideCoverageArea" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PropertyPricingTier" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "characteristics" JSONB NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PropertyPricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBookingConversation" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "bookingId" TEXT,
  "provider" TEXT NOT NULL,
  "state" "CustomerBookingConversationState" NOT NULL DEFAULT 'INTRODUCTION',
  "lastQuestionKey" TEXT,
  "automationPausedAt" TIMESTAMP(3),
  "lastInboundAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerBookingConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PropertyPricingTier_label_key" ON "PropertyPricingTier"("label");
CREATE INDEX "Booking_propertyPricingTierId_idx" ON "Booking"("propertyPricingTierId");
CREATE UNIQUE INDEX "CustomerBookingConversation_bookingId_key" ON "CustomerBookingConversation"("bookingId");
CREATE INDEX "CustomerBookingConversation_customerId_state_idx" ON "CustomerBookingConversation"("customerId", "state");
CREATE INDEX "CustomerBookingConversation_state_lastInboundAt_idx" ON "CustomerBookingConversation"("state", "lastInboundAt");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_propertyPricingTierId_fkey" FOREIGN KEY ("propertyPricingTierId") REFERENCES "PropertyPricingTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerBookingConversation" ADD CONSTRAINT "CustomerBookingConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerBookingConversation" ADD CONSTRAINT "CustomerBookingConversation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
