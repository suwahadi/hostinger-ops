import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test } from "vitest";
import { buildApp } from "./app.js";

const apiKey = "k".repeat(40);
const headers = { "x-api-key": apiKey };
const db = await createTestDb();
const app = buildApp({ db, apiKey, masterKey: parseMasterKey("ab".repeat(32)), limiter: { acquire: async () => {} } });
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const day = 24 * 60 * 60 * 1000;
const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
await db.hostingerLogin.create({ data: { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" } });
const accountA = await db.hostingAccount.create({
  data: { code: "A", loginId: sumber.id, websiteCount: 3, expiresAt: new Date(Date.now() + 10 * day), username: "u1", status: "active" },
});
await db.hostingAccount.create({
  data: { code: "B", loginId: sumber.id, websiteCount: 1, expiresAt: new Date(Date.now() + 90 * day) },
});
await db.hostingAccount.create({
  data: { code: "C", loginId: sumber.id, websiteCount: 5, status: "UNKNOWN", expiresAt: new Date(Date.now() - 5 * day) },
});
await db.website.create({
  data: { accountId: accountA.id, domain: "contoh.com", webRoot: "/home/u1/domains/contoh.com/public_html", metadata: { provider: {} } },
});

const get = (url: string) => app.inject({ url, headers });
const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers, payload });

test("POST /v1/sync queues one job per login and dedupes a repeat", async () => {
  const first = (await post("/v1/sync", {})).json().jobs as { id: string; login: string; created: boolean }[];
  expect(first.map((j) => j.login).sort()).toEqual(["sumber", "tujuan"]);
  expect(first.every((j) => j.created)).toBe(true);
  const again = (await post("/v1/sync", { login: "sumber" })).json().jobs;
  expect(again).toEqual([expect.objectContaining({ id: first.find((j) => j.login === "sumber")!.id, created: false })]);
});

test("POST /v1/sync for an unknown login is 404", async () => {
  const res = await post("/v1/sync", { login: "tidak-ada" });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "login_not_found" });
});

test("list logins shows the latest sync job", async () => {
  const sumberRow = (await get("/v1/logins")).json().logins.find((l: { alias: string }) => l.alias === "sumber");
  expect(sumberRow).toMatchObject({ lastSyncedAt: null, sync: { status: "QUEUED", error: null, finishedAt: null } });
});

test("website details match the domain case-insensitively", async () => {
  expect((await get("/v1/websites/CONTOH.COM")).json().websites[0]).toMatchObject({
    domain: "contoh.com",
    accountCode: "A",
    loginAlias: "sumber",
    webRoot: "/home/u1/domains/contoh.com/public_html",
  });
  const missing = await get("/v1/websites/tidak-ada.com");
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: "website_not_found" });
});

test("accounts carry username, status and expiry", async () => {
  const accounts = (await get("/v1/accounts?login=sumber")).json().accounts;
  expect(accounts.find((a: { code: string }) => a.code === "A")).toMatchObject({
    username: "u1",
    status: "active",
    expiresAt: expect.any(String),
    autoRenew: null,
  });
});

test("capacity lists accounts by fewest websites, flags plans expiring within 30 days, and leaves UNKNOWN plans out", async () => {
  const body = (await get("/v1/capacity")).json();
  const sumberReport = body.logins.find((l: { alias: string }) => l.alias === "sumber");
  expect(sumberReport.accounts.map((a: { code: string }) => a.code)).toEqual(["B", "A"]);
  expect(sumberReport.totals).toEqual({ accounts: 2, websites: 4, unknownAccounts: 1 });
  expect(body.expiringSoon.map((a: { code: string }) => a.code)).toEqual(["A"]);
  expect((await get("/v1/capacity?login=tujuan")).json().logins).toEqual([
    { alias: "tujuan", totals: { accounts: 0, websites: 0, unknownAccounts: 0 }, accounts: [] },
  ]);
});

test("a plan shared with another login appears in both logins' reports but is counted once overall", async () => {
  const tujuanLogin = await db.hostingerLogin.findUniqueOrThrow({ where: { alias: "tujuan" } });
  const shared = await db.hostingAccount.create({ data: { code: "S", loginId: sumber.id, websiteCount: 2, status: "active" } });
  await db.hostingAccountAccess.createMany({
    data: [
      { loginId: sumber.id, accountId: shared.id },
      { loginId: tujuanLogin.id, accountId: shared.id },
    ],
  });
  const body = (await get("/v1/capacity")).json();
  const tujuanReport = body.logins.find((l: { alias: string }) => l.alias === "tujuan");
  expect(tujuanReport.accounts).toEqual([expect.objectContaining({ code: "S", loginAlias: "sumber", sharedWith: ["tujuan"] })]);
  expect(tujuanReport.totals).toEqual({ accounts: 1, websites: 2, unknownAccounts: 0 });
  expect(body.totals).toEqual({ accounts: 3, websites: 6 });
  const tujuanAccounts = (await get("/v1/accounts?login=tujuan")).json().accounts;
  expect(tujuanAccounts.map((a: { code: string }) => a.code)).toEqual(["S"]);
});
