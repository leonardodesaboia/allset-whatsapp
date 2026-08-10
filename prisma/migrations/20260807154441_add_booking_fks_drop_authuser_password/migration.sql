/*
  Warnings:

  - You are about to drop the column `passwordHash` on the `AuthUser` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AuthUser" DROP COLUMN "passwordHash";

-- CreateIndex
CREATE INDEX "Booking_serviceId_idx" ON "Booking"("serviceId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ServiceDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
