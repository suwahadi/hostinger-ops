import { randomUUID } from "node:crypto";
import { createTestDb } from "@ops/database/test-db";
import { encryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import type { JobRow } from "../queue.js";
import { syncLoginInventory } from "./sync-login.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
afterAll(() => db.$disconnect());

const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
const tujuan = await db.hostingerLogin.create({ data: { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" } });
await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret("tok-sumber", key) } });
await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_TUJUAN", ...encryptSecret("tok-tujuan", key) } });

type Fixture = { orders: object[]; subscriptions: object[]; websites: object[] };

function hostinger(fixture: Fixture) {
  return vi.fn(async (input: string | URL | Request) => {
    const { pathname } = new URL(String(input));
    const page = (items: object[]) => ({ data: items, meta: { current_page: 1, per_page: 50, total: items.length } });
    const bodies: Record<string, unknown> = {
      "/api/hosting/v1/orders": page(fixture.orders),
      "/api/hosting/v1/websites": page(fixture.websites),
      "/api/billing/v1/subscriptions": fixture.subscriptions,
    };
    return new Response(JSON.stringify(bodies[pathname] ?? {}), { status: pathname in bodies ? 200 : 404 });
  });
}

const sync = (loginId: string, fixture: Fixture) =>
  syncLoginInventory(
    { db, masterKey: key, limiter: { acquire: async () => {} }, sleep: async () => {}, fetch: hostinger(fixture) },
    { id: randomUUID(), kind: "sync-login", attempts: 1, payload: { loginId } } satisfies JobRow,
  );

const order = (id: number) => ({ id, status: "active", plan: { name: "Premium" }, subscription_id: `sub-${id}` });
const site = (domain: string, orderId: number) => ({ domain, order_id: orderId, is_enabled: true, website_type: "wordpress" });

// Order 500 is visible to both logins and billed to sumber; 600 belongs to tujuan alone, 700 to sumber alone.
const tujuanView: Fixture = { orders: [order(500), order(600)], subscriptions: [], websites: [site("x.com", 500), site("y.com", 600)] };
const sumberView: Fixture = {
  orders: [order(500), order(700)],
  subscriptions: [{ id: "sub-500", expires_at: "2026-12-01T00:00:00Z", is_auto_renewed: false }],
  websites: [site("x.com", 500), site("z.com", 700)],
};

async function snapshot() {
  const accounts = await db.hostingAccount.findMany({
    orderBy: { code: "asc" },
    select: { code: true, loginId: true, ownerSource: true, status: true, access: { select: { loginId: true }, orderBy: { loginId: "asc" } } },
  });
  const websites = await db.website.findMany({ orderBy: { domain: "asc" }, select: { domain: true, accountId: true, status: true } });
  return { accounts, websites };
}

test("a plan seen first by a login that does not pay for it is owned provisionally", async () => {
  await sync(tujuan.id, tujuanView);
  expect(await db.hostingAccount.findUniqueOrThrow({ where: { code: "500" } })).toMatchObject({
    loginId: tujuan.id,
    ownerSource: "FIRST_SEEN",
  });
});

test("the paying login takes ownership; the plan and its websites are stored once with access for both logins", async () => {
  const result = await sync(sumber.id, sumberView);
  expect(result.subscriptions).toBe(1);
  const shared = await db.hostingAccount.findUniqueOrThrow({ where: { code: "500" }, include: { access: true } });
  expect(shared).toMatchObject({ loginId: sumber.id, ownerSource: "BILLING", expiresAt: new Date("2026-12-01T00:00:00Z") });
  expect(shared.access.map((a) => a.loginId).sort()).toEqual([sumber.id, tujuan.id].sort());
  expect(await db.website.count({ where: { domain: "x.com" } })).toBe(1);
  expect(await db.hostingAccount.count()).toBe(3);
});

test("re-syncing both logins changes nothing", async () => {
  const before = await snapshot();
  await sync(tujuan.id, tujuanView);
  await sync(sumber.id, sumberView);
  await sync(tujuan.id, tujuanView);
  expect(await snapshot()).toEqual(before);
});

test("losing access from one login keeps the plan while another login still sees it", async () => {
  const result = await sync(tujuan.id, { orders: [order(600)], subscriptions: [], websites: [site("y.com", 600)] });
  expect(result.markedUnknown).toEqual({ accounts: 0, websites: 0 });
  const shared = await db.hostingAccount.findUniqueOrThrow({ where: { code: "500" }, include: { access: true } });
  expect(shared.status).toBe("active");
  expect(shared.access.map((a) => a.loginId)).toEqual([sumber.id]);
  expect((await db.website.findFirstOrThrow({ where: { domain: "x.com" } })).status).toBe("ACTIVE");
});

test("a plan no login can see any more becomes UNKNOWN with its websites", async () => {
  const result = await sync(sumber.id, {
    orders: [order(700)],
    subscriptions: [],
    websites: [site("z.com", 700)],
  });
  expect(result.markedUnknown).toEqual({ accounts: 1, websites: 1 });
  expect((await db.hostingAccount.findUniqueOrThrow({ where: { code: "500" } })).status).toBe("UNKNOWN");
  expect((await db.website.findFirstOrThrow({ where: { domain: "x.com" } })).status).toBe("UNKNOWN");
});
