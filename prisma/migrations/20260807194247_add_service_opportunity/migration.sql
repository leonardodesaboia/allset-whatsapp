-- CreateEnum
CREATE TYPE "ServiceOpportunityStatus" AS ENUM ('OPEN', 'FILLED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpportunityResponseValue" AS ENUM ('ACCEPTED', 'DECLINED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "neighborhood" TEXT,
ADD COLUMN     "professionalPaymentCents" INTEGER,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ServiceOpportunity" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "neighborhood" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 180,
    "paymentCents" INTEGER NOT NULL,
    "status" "ServiceOpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityResponse" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "response" "OpportunityResponseValue",

    CONSTRAINT "OpportunityResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOpportunity_bookingId_key" ON "ServiceOpportunity"("bookingId");

-- CreateIndex
CREATE INDEX "ServiceOpportunity_status_expiresAt_idx" ON "ServiceOpportunity"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "OpportunityResponse_leadId_response_idx" ON "OpportunityResponse"("leadId", "response");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityResponse_opportunityId_leadId_key" ON "OpportunityResponse"("opportunityId", "leadId");

-- AddForeignKey
ALTER TABLE "ServiceOpportunity" ADD CONSTRAINT "ServiceOpportunity_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "ServiceOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityResponse" ADD CONSTRAINT "OpportunityResponse_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RecruitmentLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
