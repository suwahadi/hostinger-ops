import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import { addLogin, defaultTokenRef } from "./logins.js";
import { storeSecret } from "./secrets.js";
import { verifyLogin } from "./verify-login.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
const token = "tok-rahasia-123";
afterAll(() => db.$disconnect());

const deps = (fetch: typeof globalThis.fetch) => ({
  db,
  masterKey: key,
  limiter: { acquire: async () => {} },
  sleep: async () => {},
  fetch,
  requestId: "req-1",
});

async function seedLogin(alias: string, value: string) {
  await addLogin(db, { alias, tokenRef: defaultTokenRef(alias) });
  await storeSecret(db, key, { refKey: defaultTokenRef(alias), value });
}

const fetchAll200WithPortfolio = (domain: string) =>
  vi.fn(async (url: string | URL | Request) => {
    const body = String(url).includes("/api/domains/v1/portfolio") ? [{ domain }] : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });

const fetchAlways = (status: number) => vi.fn(async () => new Response("{}", { status }));

test("connected login: upserts four capabilities and audits every call without the token", async () => {
  await seedLogin("sumber", token);
  const result = await verifyLogin(deps(fetchAll200WithPortfolio("contoh.com")), "sumber");
  expect(result?.login).toMatchObject({ alias: "sumber", status: "CONNECTED", lastVerifiedAt: expect.any(String) });
  expect(result?.hint).toBeNull();
  expect(result?.capabilities.map((c) => c.name).sort()).toEqual([
    "dns.zone.read",
    "domains.portfolio.list",
    "hosting.orders.list",
    "hosting.websites.list",
  ]);
  const audit = await db.auditLog.findMany({ where: { requestId: "req-1" } });
  expect(audit.filter((a) => a.action === "HOSTINGER_API_CALL")).toHaveLength(4);
  expect(audit.find((a) => a.action === "LOGIN_VERIFY")?.result).toBe("CONNECTED");
  expect(JSON.stringify({ result, audit })).not.toContain(token);
});

test("a second verify updates capabilities instead of duplicating them", async () => {
  await verifyLogin(deps(fetchAll200WithPortfolio("contoh.com")), "sumber");
  expect(await db.hostingCapability.count()).toBe(4);
});

test("rejected token marks the login TOKEN_INVALID", async () => {
  const result = await verifyLogin(deps(fetchAlways(401)), "sumber");
  expect(result?.login.status).toBe("TOKEN_INVALID");
  expect(result?.hint).toContain("ops:secret:set HOSTINGER_TOKEN_SUMBER");
  expect(result?.capabilities.find((c) => c.name === "hosting.websites.list")).toMatchObject({
    available: false,
    note: "token rejected",
  });
});

test("missing secret marks NO_TOKEN and calls nothing", async () => {
  await addLogin(db, { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" });
  const fetchMock = vi.fn();
  const result = await verifyLogin(deps(fetchMock), "tujuan");
  expect(result?.login.status).toBe("NO_TOKEN");
  expect(result?.hint).toContain("ops:secret:set HOSTINGER_TOKEN_TUJUAN");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("secret under another master key marks SECRET_UNREADABLE", async () => {
  await addLogin(db, { alias: "lama", tokenRef: "HOSTINGER_TOKEN_LAMA" });
  await storeSecret(db, parseMasterKey("cd".repeat(32)), { refKey: "HOSTINGER_TOKEN_LAMA", value: "tok" });
  const result = await verifyLogin(deps(vi.fn()), "lama");
  expect(result?.login.status).toBe("SECRET_UNREADABLE");
  expect(result?.hint).toContain("SECRETS_MASTER_KEY");
});

test("unknown alias returns null", async () => {
  expect(await verifyLogin(deps(vi.fn()), "tidak-ada")).toBeNull();
});
