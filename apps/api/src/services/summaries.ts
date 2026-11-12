import type { Prisma, PrismaClient } from "@ops/database";
import { AccountSummary, LoginSummary } from "@ops/shared";

export const iso = (date: Date | null) => date?.toISOString() ?? null;

export const syncDedupeKey = (loginId: string) => `sync-login:${loginId}`;

export async function loginSummaries(db: PrismaClient, where: Prisma.HostingerLoginWhereInput = {}): Promise<LoginSummary[]> {
  const logins = await db.hostingerLogin.findMany({ where, orderBy: { alias: "asc" } });
  const latestJobs = await db.job.findMany({
    where: { dedupeKey: { in: logins.map((l) => syncDedupeKey(l.id)) } },
    orderBy: [{ dedupeKey: "asc" }, { createdAt: "desc" }],
    distinct: ["dedupeKey"],
  });
  const jobByKey = new Map(latestJobs.map((j) => [j.dedupeKey, j]));
  return logins.map((login) => {
    const job = jobByKey.get(syncDedupeKey(login.id));
    return LoginSummary.parse({
      ...login,
      lastVerifiedAt: iso(login.lastVerifiedAt),
      lastSyncedAt: iso(login.lastSyncedAt),
      sync: job ? { jobId: job.id, status: job.status, error: job.error, finishedAt: iso(job.finishedAt) } : null,
    });
  });
}

export const accountInclude = {
  login: { select: { alias: true } },
  access: { select: { login: { select: { alias: true } } } },
} satisfies Prisma.HostingAccountInclude;

type AccountWithLogins = Prisma.HostingAccountGetPayload<{ include: typeof accountInclude }>;

export function accessibleBy(alias: string): Prisma.HostingAccountWhereInput {
  return { OR: [{ login: { alias } }, { access: { some: { login: { alias } } } }] };
}

export function toAccountSummary(account: AccountWithLogins): AccountSummary {
  return AccountSummary.parse({
    ...account,
    loginAlias: account.login.alias,
    sharedWith: account.access
      .map((a) => a.login.alias)
      .filter((alias) => alias !== account.login.alias)
      .sort(),
    expiresAt: iso(account.expiresAt),
    lastSyncedAt: iso(account.lastSyncedAt),
  });
}
