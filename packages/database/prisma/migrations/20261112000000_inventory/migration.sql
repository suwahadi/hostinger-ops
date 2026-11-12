-- AlterTable
ALTER TABLE "hosting_accounts" ADD COLUMN     "autoRenew" BOOLEAN,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT,
ADD COLUMN     "subscriptionId" TEXT;

-- AlterTable
ALTER TABLE "hostinger_logins" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_status_runAfter_idx" ON "jobs"("status", "runAfter");

-- CreateIndex
CREATE INDEX "jobs_dedupeKey_idx" ON "jobs"("dedupeKey");


-- At most one QUEUED or RUNNING job per dedupe key (PRD §5.2 queue)
CREATE UNIQUE INDEX "jobs_active_dedupe" ON "jobs" ("dedupeKey") WHERE "status" IN ('QUEUED', 'RUNNING');
