import type { Prisma, PrismaClient } from "@ops/database";
import type { AccountSummary } from "@ops/shared";
import { accessibleBy, accountInclude, toAccountSummary } from "./summaries.js";

const EXPIRING_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

// One counting rule for the web dashboard and /v1/capacity, so both always show the same numbers (design §4.2a).
const knownAccount = { OR: [{ status: null }, { status: { not: "UNKNOWN" } }] } satisfies Prisma.HostingAccountWhereInput;
const countedWebsite = { status: { not: "UNKNOWN" }, account: knownAccount } satisfies Prisma.WebsiteWhereInput;

export type InventoryTotals = { logins: number; accounts: number; websites: number; wordpress: number };

export type CapacityReport = {
  totals: { accounts: number; websites: number };
  logins: {
    alias: string;
    totals: { accounts: number; websites: number; unknownAccounts: number };
    accounts: AccountSummary[];
  }[];
  expiringSoon: AccountSummary[];
};

export async function inventoryTotals(db: PrismaClient): Promise<InventoryTotals> {
  const [logins, accounts, websites, wordpress] = await Promise.all([
    db.hostingerLogin.count(),
    db.hostingAccount.count({ where: knownAccount }),
    db.website.count({ where: countedWebsite }),
    db.website.count({ where: { ...countedWebsite, websiteType: "WORDPRESS" } }),
  ]);
  return { logins, accounts, websites, wordpress };
}

export async function capacityReport(db: PrismaClient, login?: string): Promise<CapacityReport> {
  const [logins, allAccounts, websiteCounts] = await Promise.all([
    db.hostingerLogin.findMany({ where: login ? { alias: login } : {}, orderBy: { alias: "asc" } }),
    db.hostingAccount.findMany({ where: login ? accessibleBy(login) : {}, include: accountInclude }),
    db.website.groupBy({ by: ["accountId"], where: { status: { not: "UNKNOWN" } }, _count: { _all: true } }),
  ]);
  const websitesOf = new Map(websiteCounts.map((row) => [row.accountId, row._count._all]));
  const countOf = (account: { id: string }) => websitesOf.get(account.id) ?? 0;
  const sumWebsites = (list: { id: string }[]) => list.reduce((sum, a) => sum + countOf(a), 0);
  const isKnown = (a: { status: string | null }) => a.status !== "UNKNOWN";
  const reachableFrom = (alias: string) => (a: (typeof allAccounts)[number]) =>
    a.login.alias === alias || a.access.some((access) => access.login.alias === alias);
  const deadline = Date.now() + EXPIRING_WITHIN_MS;
  const known = allAccounts.filter(isKnown);

  return {
    totals: { accounts: known.length, websites: sumWebsites(known) },
    logins: logins.map((l) => {
      const reachable = allAccounts.filter(reachableFrom(l.alias));
      const knownHere = reachable.filter(isKnown);
      return {
        alias: l.alias,
        totals: { accounts: knownHere.length, websites: sumWebsites(knownHere), unknownAccounts: reachable.length - knownHere.length },
        accounts: [...knownHere].sort((a, b) => countOf(a) - countOf(b)).map(toAccountSummary),
      };
    }),
    // Already-expired plans are included: they are the most urgent ones.
    expiringSoon: known
      .filter((a) => a.expiresAt && a.expiresAt.getTime() <= deadline)
      .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
      .map(toAccountSummary),
  };
}
