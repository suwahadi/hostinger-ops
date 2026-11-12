import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import { buildApp } from "../app.js";
import { addLogin, defaultTokenRef } from "../services/logins.js";
import { storeSecret } from "../services/secrets.js";
import { setUiPassword } from "../services/ui-password.js";

const masterKey = parseMasterKey("ab".repeat(32));
const password = "kata sandi panjang 1";
const host = "127.0.0.1:3000";
const db = await createTestDb();
const hostingerFetch = vi.fn(async (url: string | URL | Request) => {
  const body = String(url).includes("/api/domains/v1/portfolio") ? [{ domain: "contoh.com" }] : {};
  return new Response(JSON.stringify(body), { status: 200 });
});
const app = buildApp({ db, apiKey: "k".repeat(40), masterKey, fetch: hostingerFetch, limiter: { acquire: async () => {} }, sleep: async () => {} });
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

for (const alias of ["sumber", "tujuan"]) await addLogin(db, { alias, tokenRef: defaultTokenRef(alias) });
await storeSecret(db, masterKey, { refKey: defaultTokenRef("sumber"), value: "tok-rahasia-123" });
await setUiPassword(db, password);

const form = { host, origin: `http://${host}`, "content-type": "application/x-www-form-urlencoded" };
const loginRes = await app.inject({ method: "POST", url: "/login", headers: form, payload: new URLSearchParams({ password }).toString() });
const cookie = String(loginRes.headers["set-cookie"]).split(";")[0]!;

const post = (url: string, fields: Record<string, string>) =>
  app.inject({ method: "POST", url, headers: { ...form, cookie }, payload: new URLSearchParams(fields).toString() });
const messageOf = (location: unknown) => new URL(String(location), `http://${host}`).searchParams.get("pesan") ?? "";

test("Ringkasan offers the sync-all button and per-login test and sync buttons", async () => {
  const body = (await app.inject({ url: "/ringkasan", headers: { host, cookie } })).body;
  expect(body).toContain('action="/aksi/sinkron"');
  expect(body).toContain('action="/aksi/uji"');
  expect(body).toContain('name="login" value="sumber"');
  expect(body).toContain("Sinkronkan semua login");
});

test("Sinkronkan queues one job per login, a second press does not duplicate, both audited as WEB_HUMAN", async () => {
  const first = await post("/aksi/sinkron", { kembali: "/ringkasan" });
  expect(first.statusCode).toBe(303);
  expect(String(first.headers.location)).toMatch(/^\/ringkasan\?pesan=/);
  expect(messageOf(first.headers.location)).toContain("Sinkronisasi diantrekan untuk 2 login");
  const again = await post("/aksi/sinkron", { login: "sumber", kembali: "/ringkasan" });
  expect(messageOf(again.headers.location)).toContain("Sinkronisasi untuk sumber sudah dalam antrean");
  expect(await db.job.count()).toBe(2);
  expect(await db.auditLog.count({ where: { action: "SYNC_REQUEST", actor: "WEB_HUMAN" } })).toBe(3);
});

test("Sinkronkan for an unknown login says so", async () => {
  expect(messageOf((await post("/aksi/sinkron", { login: "tidak-ada" })).headers.location)).toContain("Login tidak-ada tidak ditemukan");
});

test("Uji koneksi runs verification with a fake fetch and reports the status, audited as WEB_HUMAN", async () => {
  const res = await post("/aksi/uji", { login: "sumber", kembali: "/ringkasan" });
  expect(res.statusCode).toBe(303);
  expect(messageOf(res.headers.location)).toContain("sumber: CONNECTED");
  expect(hostingerFetch).toHaveBeenCalled();
  expect(await db.auditLog.count({ where: { action: "LOGIN_VERIFY", actor: "WEB_HUMAN" } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: "HOSTINGER_API_CALL", actor: "CLAUDE_MCP" } })).toBe(0);
});

test("Uji koneksi passes the hint along and handles an unknown login", async () => {
  expect(messageOf((await post("/aksi/uji", { login: "tujuan" })).headers.location)).toContain("ops:secret:set HOSTINGER_TOKEN_TUJUAN");
  expect(messageOf((await post("/aksi/uji", { login: "tidak-ada" })).headers.location)).toContain("Login tidak-ada tidak ditemukan");
});

test("the return path is honoured for /paket?login=a and replaced for //evil.com", async () => {
  expect(String((await post("/aksi/sinkron", { kembali: "/paket?login=sumber" })).headers.location)).toMatch(
    /^\/paket\?login=sumber&pesan=/,
  );
  expect(String((await post("/aksi/sinkron", { kembali: "//evil.com/x" })).headers.location)).toMatch(/^\/ringkasan\?pesan=/);
});

test("the message is shown on the page it returns to", async () => {
  const res = await post("/aksi/sinkron", { login: "sumber", kembali: "/ringkasan" });
  const page = await app.inject({ url: String(res.headers.location), headers: { host, cookie } });
  expect(page.body).toContain('role="status"');
  expect(page.body).toContain("Sinkronisasi untuk sumber");
});

test("a return path that normalizes to another site never leaves the dashboard", async () => {
  for (const kembali of ["/.//evil.com", "/a/..//evil.com", "/%2e//evil.com"]) {
    const location = String((await post("/aksi/sinkron", { kembali })).headers.location);
    expect(location.startsWith("//")).toBe(false);
    expect(new URL(location, `http://${host}`).origin).toBe(`http://${host}`);
  }
});
