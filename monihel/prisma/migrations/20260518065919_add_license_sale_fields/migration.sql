/*
  Warnings:

  - A unique constraint covering the columns `[saleId]` on the table `LicenseKey` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "LicenseKey" ADD COLUMN     "productId" TEXT,
ADD COLUMN     "saleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_saleId_key" ON "LicenseKey"("saleId");
