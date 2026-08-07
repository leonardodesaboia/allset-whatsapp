-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "assignedProfessionalLeadId" TEXT;

-- AlterTable
ALTER TABLE "OpportunityResponse" ADD COLUMN "responseToken" TEXT;

-- CreateIndex
CREATE INDEX "Booking_assignedProfessionalLeadId_idx" ON "Booking"("assignedProfessionalLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityResponse_responseToken_key" ON "OpportunityResponse"("responseToken");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_assignedProfessionalLeadId_fkey" FOREIGN KEY ("assignedProfessionalLeadId") REFERENCES "RecruitmentLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
