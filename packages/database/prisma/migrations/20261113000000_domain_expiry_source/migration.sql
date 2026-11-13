-- AlterTable
ALTER TABLE "domains" ADD COLUMN     "expiryCheckedAt" TIMESTAMP(3),
ADD COLUMN     "expirySource" TEXT;

