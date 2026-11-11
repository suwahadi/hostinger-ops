import { createTestDb } from "@ops/database/test-db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const apiKey = "k".repeat(40);
const auth = { "x-api-key": apiKey };
const db = await createTestDb();
const app = buildApp({ db, apiKey });

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
  expect(res.json().logins).toEqual([{ alias: "sumber", status: expect.any(String), lastVerifiedAt: null }]);
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
  const broken = buildApp({ db: {} as never, apiKey });
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
