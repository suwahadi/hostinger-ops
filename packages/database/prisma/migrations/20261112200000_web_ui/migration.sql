-- AlterEnum
ALTER TYPE "AuditActor" ADD VALUE 'WEB_HUMAN';

-- CreateTable
CREATE TABLE "ui_credentials" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ui_credentials_pkey" PRIMARY KEY ("id")
);

