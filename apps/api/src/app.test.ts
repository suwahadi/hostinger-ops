import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { storeSecret } from "./services/secrets.js";

const apiKey = "k".repeat(40);
const masterKey = parseMasterKey("ab".repeat(32));
const auth = { "x-api-key": apiKey };
const db = await createTestDb();
const hostingerFetch = vi.fn(async (url: string | URL | Request) => {
  const body = String(url).includes("/api/domains/v1/portfolio") ? [{ domain: "contoh.com" }] : {};
  return new Response(JSON.stringify(body), { status: 200 });
});
const app = buildApp({ db, apiKey, masterKey, fetch: hostingerFetch, limiter: { acquire: async () => {} } });

beforeAll(async () => {
  const login = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
  const account = await db.hostingAccount.create({ data: { code: "A001", loginId: login.id, planType: "premium" } });
  await db.website.createMany({
    data: [
      { accountId: account.id, domain: "contoh.com" },
      { accountId: account.id, domain: "lain.org" },
    ],
  });
  await db.hostingCapability.create({ data: { loginId: login.id, name: "websites.list", available: true, httpStatus: 200 } });
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

test("health needs no key", async () => {
  expect((await app.inject("/health")).json()).toEqual({ status: "ok", database: "up" });
});

test.each([undefined, "short", "x".repeat(40), "k".repeat(41)])("rejects key %s with 401", async (key) => {
  const res = await app.inject({ url: "/v1/logins", headers: key ? { "x-api-key": key } : {} });
  expect(res.statusCode).toBe(401);
});

test("lists logins without token references", async () => {
  const res = await app.inject({ url: "/v1/logins", headers: auth });
  expect(res.json().logins).toEqual([{ alias: "sumber", status: expect.any(String), lastVerifiedAt: null, lastSyncedAt: null, sync: null }]);
  expect(res.body).not.toContain("HOSTINGER_TOKEN");
});

test("lists accounts of a login", async () => {
  const res = await app.inject({ url: "/v1/accounts?login=sumber", headers: auth });
  expect(res.json().accounts).toMatchObject([{ code: "A001", loginAlias: "sumber", planType: "premium" }]);
});

test("filters websites by partial domain, case-insensitive", async () => {
  const res = await app.inject({ url: "/v1/websites?domain=CONTOH", headers: auth });
  expect(res.json().websites.map((w: { domain: string }) => w.domain)).toEqual(["contoh.com"]);
});

test("lists capabilities of a login", async () => {
  const res = await app.inject({ url: "/v1/logins/sumber/capabilities", headers: auth });
  expect(res.json().capabilities).toMatchObject([{ name: "websites.list", available: true, httpStatus: 200 }]);
});

test("unknown login alias returns 404", async () => {
  const res = await app.inject({ url: "/v1/logins/tidak-ada/capabilities", headers: auth });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "login_not_found" });
});

test("repeated query parameter is rejected with 400", async () => {
  const res = await app.inject({ url: "/v1/websites?domain=a&domain=b", headers: auth });
  expect(res.statusCode).toBe(400);
});

test("errors do not leak internals", async () => {
  const broken = buildApp({ db: {} as never, apiKey, masterKey });
  const res = await broken.inject({ url: "/v1/logins", headers: auth });
  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual({ error: "internal_error" });
  await broken.close();
});

test("config rejects a short API key without echoing it", () => {
  expect(() => loadConfig({ HOSTING_OPS_API_KEY: "pendek", SECRETS_MASTER_KEY: "ab".repeat(32), DATABASE_URL: "postgresql://x" })).toThrow(
    /^HOSTING_OPS_API_KEY must be at least 32 characters$/,
  );
});

test("verify route probes Hostinger and returns the login status", async () => {
  await storeSecret(db, masterKey, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "tok-rahasia-123" });
  const res = await app.inject({ method: "POST", url: "/v1/logins/sumber/verify", headers: auth });
  expect(res.statusCode).toBe(200);
  expect(res.json().login).toMatchObject({ alias: "sumber", status: "CONNECTED" });
  expect(res.json().capabilities.map((c: { name: string }) => c.name)).toEqual(
    expect.arrayContaining(["dns.zone.read", "domains.portfolio.list", "hosting.orders.list", "hosting.websites.list"]),
  );
  expect(res.body).not.toContain("tok-rahasia-123");
  const requestIds = await db.auditLog.findMany({ where: { action: "LOGIN_VERIFY" }, select: { requestId: true } });
  expect(requestIds[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("verify route returns 404 for an unknown alias", async () => {
  const res = await app.inject({ method: "POST", url: "/v1/logins/tidak-ada/verify", headers: auth });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "login_not_found" });
});

test("verify route needs the key", async () => {
  expect((await app.inject({ method: "POST", url: "/v1/logins/sumber/verify" })).statusCode).toBe(401);
});
