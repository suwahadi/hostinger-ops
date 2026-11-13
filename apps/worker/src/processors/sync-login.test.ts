import { randomUUID } from "node:crypto";
import { createTestDb } from "@ops/database/test-db";
import { encryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import { PermanentJobError, type JobRow } from "../queue.js";
import { syncLoginInventory } from "./sync-login.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
const token = "tok-rahasia-123";
afterAll(() => db.$disconnect());

const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret(token, key) } });

type Fixture = { orders: object[]; subscriptions: object[]; websites: object[]; portfolio?: object[] };

function hostinger(fixture: Fixture, failing?: { path: string; status: number }) {
  return vi.fn(async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    if (failing && pathname === failing.path) return new Response("{}", { status: failing.status });
    const page = (items: object[]) => ({ data: items, meta: { current_page: 1, per_page: 50, total: items.length } });
    const bodies: Record<string, unknown> = {
      "/api/hosting/v1/orders": page(fixture.orders),
      "/api/hosting/v1/websites": page(fixture.websites),
      "/api/billing/v1/subscriptions": fixture.subscriptions,
      ...(fixture.portfolio ? { "/api/domains/v1/portfolio": fixture.portfolio } : {}),
    };
    const body = bodies[pathname];
    return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200 });
  });
}

const hostingerFailing = (path: string, status: number) =>
  hostinger({ orders: [], subscriptions: [], websites: [] }, { path, status });

const deps = (fetch: typeof globalThis.fetch) => ({
  db,
  masterKey: key,
  limiter: { acquire: async () => {} },
  sleep: async () => {},
  fetch,
});

const job = (loginId: string = sumber.id): JobRow => ({ id: randomUUID(), kind: "sync-login", attempts: 1, payload: { loginId } });

test("creates accounts with plan, expiry and username, and websites with WordPress detected", async () => {
  const result = await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 101, status: "active", plan: { name: "Premium" }, subscription_id: "sub-1" }],
        subscriptions: [{ id: "sub-1", status: "active", expires_at: "2026-12-01T00:00:00Z", is_auto_renewed: false }],
        websites: [
          {
            domain: "contoh.com",
            order_id: 101,
            username: "u1",
            website_type: "wordpress",
            is_enabled: true,
            root_directory: "/home/u1/domains/contoh.com/public_html",
          },
          { domain: null, order_id: 101, website_type: "other", is_enabled: true },
        ],
      }),
    ),
    job(),
  );
  expect(result).toEqual({ accounts: 1, websites: 1, subscriptions: 1, markedUnknown: { accounts: 0, websites: 0 }, skippedWithoutDomain: 1, domains: null });
  expect(await db.hostingAccount.findUniqueOrThrow({ where: { code: "101" } })).toMatchObject({
    loginId: sumber.id,
    planType: "Premium",
    status: "active",
    username: "u1",
    websiteCount: 1,
    autoRenew: false,
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  expect(await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).toMatchObject({
    websiteType: "WORDPRESS",
    status: "ACTIVE",
    webRoot: "/home/u1/domains/contoh.com/public_html",
    metadata: { provider: expect.objectContaining({ websiteType: "wordpress" }) },
  });
  expect((await db.hostingerLogin.findUniqueOrThrow({ where: { id: sumber.id } })).lastSyncedAt).not.toBeNull();
});

test("keeps projectId and other metadata, and moves a website to its new order instead of duplicating it", async () => {
  const project = await db.project.create({ data: { code: "P1", name: "Proyek" } });
  await db.website.updateMany({ where: { domain: "contoh.com" }, data: { projectId: project.id, metadata: { note: "lokal", provider: {} } } });
  await syncLoginInventory(
    deps(
      hostinger({
        orders: [
          { id: 101, status: "active", plan: { name: "Premium" } },
          { id: 102, status: "active", plan: { name: "Business" } },
        ],
        subscriptions: [],
        websites: [{ domain: "contoh.com", order_id: 102, username: "u2", website_type: "wordpress", is_enabled: true }],
      }),
    ),
    job(),
  );
  const rows = await db.website.findMany({ where: { domain: "contoh.com" }, include: { account: true } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ projectId: project.id, account: { code: "102" }, metadata: { note: "lokal" } });
});

test("marks missing websites and accounts UNKNOWN instead of deleting them", async () => {
  const result = await syncLoginInventory(
    deps(hostinger({ orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [] })),
    job(),
  );
  expect(result.markedUnknown).toEqual({ accounts: 1, websites: 1 });
  expect((await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).status).toBe("UNKNOWN");
  expect((await db.hostingAccount.findUniqueOrThrow({ where: { code: "101" } })).status).toBe("UNKNOWN");
});

test("a failed page writes nothing and throws for a retry", async () => {
  const before = await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } });
  await expect(syncLoginInventory(deps(hostingerFailing("/api/hosting/v1/websites", 500)), job())).rejects.toThrow(
    "Hostinger GET /api/hosting/v1/websites failed: 500",
  );
  expect(await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).toEqual(before);
});

test("duplicate domains in one response are merged", async () => {
  const site = { domain: "ganda.com", order_id: 102, username: "u2", website_type: "other", is_enabled: true };
  const result = await syncLoginInventory(
    deps(hostinger({ orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [site, { ...site }] })),
    job(),
  );
  expect(result.websites).toBe(1);
  expect(await db.website.count({ where: { domain: "ganda.com" } })).toBe(1);
});

test("a website on an order missing from the order list keeps an account instead of vanishing", async () => {
  await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 102, status: "active", plan: { name: "Business" } }],
        subscriptions: [],
        websites: [
          { domain: "ganda.com", order_id: 102, is_enabled: true },
          { domain: "lama.com", order_id: 999, username: "u9", is_enabled: false },
        ],
      }),
    ),
    job(),
  );
  expect(await db.hostingAccount.findUniqueOrThrow({ where: { code: "999" } })).toMatchObject({ status: "UNLISTED", username: "u9" });
  expect((await db.website.findFirstOrThrow({ where: { domain: "lama.com" } })).status).toBe("SUSPENDED");
});

test("an unexpected response shape writes nothing", async () => {
  const before = await db.website.count();
  await expect(
    syncLoginInventory(deps(hostinger({ orders: [{ id: "not-a-number" }], subscriptions: [], websites: [] })), job()),
  ).rejects.toThrow("Hostinger GET /api/hosting/v1/orders returned an unexpected response shape");
  expect(await db.website.count()).toBe(before);
});

test("a login without a stored token fails permanently", async () => {
  const tujuan = await db.hostingerLogin.create({ data: { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" } });
  await expect(syncLoginInventory(deps(vi.fn()), job(tujuan.id))).rejects.toBeInstanceOf(PermanentJobError);
});

test("every Hostinger call is audited as WORKER under the job id, without the token", async () => {
  const j = job();
  await syncLoginInventory(deps(hostinger({ orders: [], subscriptions: [], websites: [] })), j);
  const audit = await db.auditLog.findMany({ where: { requestId: j.id } });
  expect(audit.filter((a) => a.action === "HOSTINGER_API_CALL" && a.actor === "WORKER")).toHaveLength(4);
  expect(audit.find((a) => a.action === "SYNC_LOGIN")?.result).toBe("OK");
  expect(JSON.stringify(audit)).not.toContain(token);
});

test("an existing mixed-case domain stays ACTIVE when Hostinger lists it in lowercase", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "102" } });
  await db.website.create({ data: { accountId: account.id, domain: "Campur.com", status: "ACTIVE" } });
  await syncLoginInventory(
    deps(hostinger({ orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [{ domain: "campur.com", order_id: 102, is_enabled: true }] })),
    job(),
  );
  expect(await db.website.findMany({ where: { domain: { equals: "campur.com", mode: "insensitive" } }, select: { status: true } })).toEqual([
    { status: "ACTIVE" },
  ]);
});

test("stores domain status and expiry from the portfolio", async () => {
  const result = await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 102, status: "active", plan: { name: "Business" } }],
        subscriptions: [],
        websites: [{ domain: "ganda.com", order_id: 102, is_enabled: true }],
        portfolio: [
          { id: 1, domain: "ganda.com", type: "domain", status: "active", expires_at: "2027-03-12T00:00:00Z" },
          { id: 2, domain: null, type: "domain", status: "pending_setup" },
        ],
      }),
    ),
    job(),
  );
  expect(result.domains).toBe(1);
  const stored = await db.domain.findUniqueOrThrow({ where: { name: "ganda.com" } });
  expect(stored).toMatchObject({ loginId: sumber.id, status: "active", expiresAt: new Date("2027-03-12T00:00:00Z"), expirySource: "HOSTINGER" });
  expect(stored.expiryCheckedAt).toBeInstanceOf(Date);
});

test("a portfolio entry without a date keeps the expiry found earlier, e.g. by the renewal check or RDAP", async () => {
  await db.domain.upsert({
    where: { name: "tanpa-tanggal.com" },
    create: { name: "tanpa-tanggal.com", expiresAt: new Date("2028-01-01T00:00:00Z"), expirySource: "RDAP" },
    update: { expiresAt: new Date("2028-01-01T00:00:00Z"), expirySource: "RDAP" },
  });
  await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 102, status: "active", plan: { name: "Business" } }],
        subscriptions: [],
        websites: [{ domain: "ganda.com", order_id: 102, is_enabled: true }],
        portfolio: [{ id: 3, domain: "tanpa-tanggal.com", type: "domain", status: "active" }],
      }),
    ),
    job(),
  );
  expect(await db.domain.findUniqueOrThrow({ where: { name: "tanpa-tanggal.com" } })).toMatchObject({
    loginId: sumber.id,
    status: "active",
    expiresAt: new Date("2028-01-01T00:00:00Z"),
    expirySource: "RDAP",
  });
});

test("a failing domain list does not fail the inventory sync", async () => {
  const result = await syncLoginInventory(
    deps(
      hostinger(
        { orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [{ domain: "ganda.com", order_id: 102, is_enabled: true }] },
        { path: "/api/domains/v1/portfolio", status: 403 },
      ),
    ),
    job(),
  );
  expect(result).toMatchObject({ accounts: 1, websites: 1, domains: null });
  expect((await db.domain.findUniqueOrThrow({ where: { name: "ganda.com" } })).expiresAt).toEqual(new Date("2027-03-12T00:00:00Z"));
});

test("Node.js apps get their own type from Hostinger, and a type recognised from the files survives a later sync", async () => {
  await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 102, status: "active", plan: { name: "Business" } }],
        subscriptions: [],
        websites: [
          { domain: "node-app.com", order_id: 102, website_type: "nodejs", is_enabled: true },
          { domain: "laravel-app.com", order_id: 102, website_type: "other", is_enabled: true },
        ],
      }),
    ),
    job(),
  );
  expect((await db.website.findFirstOrThrow({ where: { domain: "node-app.com" } })).websiteType).toBe("NODEJS");
  await db.website.updateMany({ where: { domain: "laravel-app.com" }, data: { websiteType: "LARAVEL" } });
  await syncLoginInventory(
    deps(
      hostinger({
        orders: [{ id: 102, status: "active", plan: { name: "Business" } }],
        subscriptions: [],
        websites: [{ domain: "laravel-app.com", order_id: 102, website_type: "other", is_enabled: true }],
      }),
    ),
    job(),
  );
  expect((await db.website.findFirstOrThrow({ where: { domain: "laravel-app.com" } })).websiteType).toBe("LARAVEL");
});
