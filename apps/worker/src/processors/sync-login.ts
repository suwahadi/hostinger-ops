import type { Prisma, PrismaClient } from "@ops/database";
import {
  createHostingerClient,
  createTokenProvider,
  getAllPages,
  getList,
  HostingerRequestError,
  TokenUnavailableError,
  type RateLimiter,
  type Sleep,
} from "@ops/hostinger-adapter";
import { z } from "zod";
import { PermanentJobError, type JobRow } from "../queue.js";

export type SyncDeps = { db: PrismaClient; masterKey: Buffer; limiter: RateLimiter; fetch?: typeof fetch; sleep?: Sleep };

export type SyncResult = {
  accounts: number;
  websites: number;
  subscriptions: number;
  markedUnknown: { accounts: number; websites: number };
  skippedWithoutDomain: number;
  domains: number | null;
};

const ORDERS = "/api/hosting/v1/orders";
const SUBSCRIPTIONS = "/api/billing/v1/subscriptions";
const WEBSITES = "/api/hosting/v1/websites";
const PORTFOLIO = "/api/domains/v1/portfolio";

const Order = z.object({
  id: z.number(),
  status: z.string().nullish(),
  plan: z.object({ name: z.string().nullish() }).nullish(),
  subscription_id: z.coerce.string().nullish(),
});
const Subscription = z.object({
  id: z.coerce.string(),
  expires_at: z.string().nullish(),
  is_auto_renewed: z.boolean().nullish(),
});
const Website = z.object({
  domain: z.string().nullish(),
  order_id: z.number(),
  username: z.string().nullish(),
  website_type: z.string().nullish(),
  is_enabled: z.boolean().nullish(),
  root_directory: z.string().nullish(),
  vhost_type: z.string().nullish(),
  parent_domain: z.string().nullish(),
});
type Website = z.infer<typeof Website>;
const PortfolioDomain = z.object({
  domain: z.string().nullish(),
  status: z.string().nullish(),
  expires_at: z.string().nullish(),
});

function parseItems<T>(schema: z.ZodType<T>, items: unknown[], path: string): T[] {
  const parsed = z.array(schema).safeParse(items);
  if (!parsed.success) throw new HostingerRequestError(`Hostinger GET ${path} returned an unexpected response shape`);
  return parsed.data;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const notUnknown = { OR: [{ status: null }, { status: { not: "UNKNOWN" } }] };

export async function syncLoginInventory(deps: SyncDeps, job: JobRow): Promise<SyncResult> {
  const { db } = deps;
  const payload = z.object({ loginId: z.string() }).safeParse(job.payload);
  if (!payload.success) throw new PermanentJobError("sync-login job needs { loginId }");
  const login = await db.hostingerLogin.findUnique({ where: { id: payload.data.loginId } });
  if (!login) throw new PermanentJobError(`Login ${payload.data.loginId} no longer exists`);

  let token: string;
  try {
    token = await createTokenProvider({ db, masterKey: deps.masterKey }).getToken(login.tokenRef);
  } catch (error) {
    if (error instanceof TokenUnavailableError) throw new PermanentJobError(error.message);
    throw error;
  }

  const audit = (action: string, result: string, detail?: object) =>
    db.auditLog.create({
      data: { requestId: job.id, actor: "WORKER", action, resource: "hostinger_login", resourceId: login.alias, result, detail },
    });
  const client = createHostingerClient({
    token,
    limiterKey: login.id,
    limiter: deps.limiter,
    fetch: deps.fetch,
    sleep: deps.sleep,
    onCall: async (call) => {
      await audit("HOSTINGER_API_CALL", String(call.status ?? call.error), {
        path: call.path,
        attempt: call.attempt,
        durationMs: call.durationMs,
      });
    },
  });

  // Every request must succeed before anything is written; a partial fetch would wrongly mark websites UNKNOWN.
  const orders = parseItems(Order, await getAllPages(client, ORDERS), ORDERS);
  const subscriptions = parseItems(Subscription, await getList(client, SUBSCRIPTIONS), SUBSCRIPTIONS);
  const websites = parseItems(Website, await getAllPages(client, WEBSITES), WEBSITES);
  // Domain expiry is extra information: a login without access to its domain list must still get its inventory.
  let portfolio: z.infer<typeof PortfolioDomain>[] | null = null;
  try {
    portfolio = parseItems(PortfolioDomain, await getList(client, PORTFOLIO), PORTFOLIO);
  } catch (error) {
    if (!(error instanceof HostingerRequestError)) throw error;
  }
  const registered = (portfolio ?? []).filter((d): d is typeof d & { domain: string } => Boolean(d.domain));

  const byDomain = new Map<string, Website>();
  let skippedWithoutDomain = 0;
  for (const website of websites) {
    if (!website.domain) skippedWithoutDomain++;
    else if (!byDomain.has(website.domain.toLowerCase())) byDomain.set(website.domain.toLowerCase(), website);
  }
  const subscriptionById = new Map(subscriptions.map((s) => [s.id, s]));
  const listedOrders = new Map(orders.map((o) => [o.id, o]));
  const orderIds = new Set([...listedOrders.keys(), ...[...byDomain.values()].map((w) => w.order_id)]);
  const now = new Date();

  const result = await db.$transaction(
    async (tx) => {
      const accountIdByOrder = new Map<number, string>();
      for (const orderId of orderIds) {
        const order = listedOrders.get(orderId);
        const subscription = order?.subscription_id ? subscriptionById.get(order.subscription_id) : undefined;
        const sites = [...byDomain.values()].filter((w) => w.order_id === orderId);
        const username = sites.find((w) => w.username)?.username;
        const data = {
          orderId: String(orderId),
          websiteCount: sites.length,
          lastSyncedAt: now,
          ...(username ? { username } : {}),
          ...(order
            ? { planType: order.plan?.name ?? null, status: order.status ?? null, subscriptionId: order.subscription_id ?? null }
            : {}),
          ...(subscription
            ? {
                expiresAt: subscription.expires_at ? new Date(subscription.expires_at) : null,
                autoRenew: subscription.is_auto_renewed ?? null,
              }
            : {}),
        };
        // A plan can be reachable from several logins; only the login that is billed for it may claim ownership,
        // otherwise ownership would flip to whichever login synced last.
        const billedHere = subscription ? { loginId: login.id, ownerSource: "BILLING" } : {};
        const code = String(orderId);
        const account = await tx.hostingAccount.upsert({
          where: { code },
          create: {
            code,
            ...data,
            loginId: login.id,
            ownerSource: subscription ? "BILLING" : "FIRST_SEEN",
            ...(order ? {} : { status: "UNLISTED" }),
          },
          update: { ...data, ...billedHere },
        });
        await tx.hostingAccountAccess.upsert({
          where: { loginId_accountId: { loginId: login.id, accountId: account.id } },
          create: { loginId: login.id, accountId: account.id, lastSeenAt: now },
          update: { lastSeenAt: now },
        });
        accountIdByOrder.set(orderId, account.id);
      }

      const accountIds = [...accountIdByOrder.values()];
      const lostAccess = await tx.hostingAccountAccess.findMany({
        where: { loginId: login.id, accountId: { notIn: accountIds } },
        select: { accountId: true },
      });
      const lostIds = lostAccess.map((a) => a.accountId);
      await tx.hostingAccountAccess.deleteMany({ where: { loginId: login.id, accountId: { in: lostIds } } });
      const orphanIds = (
        await tx.hostingAccount.findMany({ where: { id: { in: lostIds }, access: { none: {} } }, select: { id: true } })
      ).map((a) => a.id);
      const markedAccounts = await tx.hostingAccount.updateMany({
        where: { id: { in: orphanIds }, ...notUnknown },
        data: { status: "UNKNOWN" },
      });
      const orphanWebsites = await tx.website.updateMany({
        where: { accountId: { in: orphanIds }, status: { not: "UNKNOWN" } },
        data: { status: "UNKNOWN" },
      });

      const existing = await tx.website.findMany({ where: { accountId: { in: [...accountIds, ...lostIds] } } });
      const existingByDomain = new Map(existing.map((w) => [w.domain.toLowerCase(), w]));

      const seenIds: string[] = [];
      for (const [domain, website] of byDomain) {
        const old = existingByDomain.get(domain);
        const provider = {
          websiteType: website.website_type ?? null,
          vhostType: website.vhost_type ?? null,
          parentDomain: website.parent_domain ?? null,
          username: website.username ?? null,
        };
        const data = {
          accountId: accountIdByOrder.get(website.order_id)!,
          webRoot: website.root_directory ?? null,
          status: website.is_enabled === false ? "SUSPENDED" : "ACTIVE",
          ...(website.website_type === "wordpress" ? { websiteType: "WORDPRESS" as const } : {}),
          metadata: { ...asObject(old?.metadata), provider } as Prisma.InputJsonObject,
        };
        const row = old
          ? await tx.website.update({ where: { id: old.id }, data })
          : await tx.website.create({ data: { domain, ...data } });
        seenIds.push(row.id);
      }

      // Marked by id, not by domain: stored domains may differ in case from what Hostinger returns.
      const markedWebsites = await tx.website.updateMany({
        where: { accountId: { in: accountIds }, id: { notIn: seenIds }, status: { not: "UNKNOWN" } },
        data: { status: "UNKNOWN" },
      });
      for (const entry of registered) {
        const data = {
          loginId: login.id,
          status: entry.status ?? null,
          expiresAt: entry.expires_at ? new Date(entry.expires_at) : null,
        };
        const name = entry.domain.toLowerCase();
        await tx.domain.upsert({ where: { name }, create: { name, ...data }, update: data });
      }
      await tx.hostingerLogin.update({ where: { id: login.id }, data: { lastSyncedAt: now } });

      return {
        accounts: orderIds.size,
        websites: byDomain.size,
        subscriptions: subscriptions.length,
        markedUnknown: { accounts: markedAccounts.count, websites: markedWebsites.count + orphanWebsites.count },
        skippedWithoutDomain,
        domains: portfolio ? registered.length : null,
      };
    },
    { timeout: 60_000 },
  );

  await audit("SYNC_LOGIN", "OK", result);
  return result;
}
