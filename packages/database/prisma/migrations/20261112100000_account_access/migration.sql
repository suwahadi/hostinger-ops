-- AlterTable
ALTER TABLE "hosting_accounts" ADD COLUMN     "ownerSource" TEXT NOT NULL DEFAULT 'FIRST_SEEN';

-- CreateTable
CREATE TABLE "hosting_account_access" (
    "loginId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosting_account_access_pkey" PRIMARY KEY ("loginId","accountId")
);

-- CreateIndex
CREATE INDEX "hosting_account_access_accountId_idx" ON "hosting_account_access"("accountId");

-- AddForeignKey
ALTER TABLE "hosting_account_access" ADD CONSTRAINT "hosting_account_access_loginId_fkey" FOREIGN KEY ("loginId") REFERENCES "hostinger_logins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hosting_account_access" ADD CONSTRAINT "hosting_account_access_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "hosting_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every existing plan stays reachable from the login that already holds it.
INSERT INTO "hosting_account_access" ("loginId", "accountId", "lastSeenAt")
SELECT "loginId", "id", CURRENT_TIMESTAMP FROM "hosting_accounts"
ON CONFLICT DO NOTHING;
