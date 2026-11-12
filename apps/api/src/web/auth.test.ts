import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test } from "vitest";
import { buildApp, type AppDeps } from "../app.js";
import { setUiPassword } from "../services/ui-password.js";
import { safeReturnPath } from "./guard.js";
import { createLoginThrottle, createSessionStore } from "./session.js";

const apiKey = "k".repeat(40);
const password = "kata sandi panjang 1";
const db = await createTestDb();
const apps: ReturnType<typeof buildApp>[] = [];
afterAll(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db.$disconnect();
});

function makeApp(extra: Partial<AppDeps> = {}) {
  const app = buildApp({ db, apiKey, masterKey: parseMasterKey("ab".repeat(32)), limiter: { acquire: async () => {} }, ...extra });
  apps.push(app);
  return app;
}

const app = makeApp();
const sameOrigin = { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" };
const form = { "content-type": "application/x-www-form-urlencoded" };

function postLogin(target: ReturnType<typeof buildApp>, value: string, headers: Record<string, string> = sameOrigin) {
  return target.inject({ method: "POST", url: "/login", headers: { ...form, ...headers }, payload: new URLSearchParams({ password: value }).toString() });
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const header = String(res.headers["set-cookie"] ?? "");
  return header.split(";")[0]!;
}

test("before any password exists /login explains ops:ui:password", async () => {
  const res = await app.inject({ url: "/login", headers: { host: "127.0.0.1:3000" } });
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("ops:ui:password");
});

test("without a session GET goes to /login and POST is 401", async () => {
  await setUiPassword(db, password);
  const get = await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000" } });
  expect(get.statusCode).toBe(302);
  expect(get.headers.location).toBe("/login");
  const post = await app.inject({ method: "POST", url: "/aksi/sinkron", headers: { ...form, ...sameOrigin }, payload: "" });
  expect(post.statusCode).toBe(401);
});

test("correct password sets an HttpOnly SameSite=Strict cookie and opens /ringkasan", async () => {
  const res = await postLogin(app, password);
  expect(res.statusCode).toBe(303);
  expect(res.headers.location).toBe("/ringkasan");
  const setCookie = String(res.headers["set-cookie"]);
  expect(setCookie).toMatch(/^ops_session=[0-9a-f]{64}; /);
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Path=/");
  const page = await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie: cookieOf(res) } });
  expect(page.statusCode).toBe(200);
  expect(await db.auditLog.count({ where: { action: "UI_LOGIN", result: "ok", actor: "WEB_HUMAN" } })).toBe(1);
});

test("wrong password stays on /login with 401 and audits wrong_password", async () => {
  const res = await postLogin(app, "salah sekali bukan ini");
  expect(res.statusCode).toBe(401);
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.body).toContain("Password salah");
  const audit = await db.auditLog.findMany({ where: { action: "UI_LOGIN", result: "wrong_password" } });
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain("salah sekali");
});

test("the sixth failure in 15 minutes is locked with 429", async () => {
  const locked = makeApp({ throttle: createLoginThrottle() });
  for (let i = 0; i < 5; i++) expect((await postLogin(locked, "bukan password")).statusCode).toBe(401);
  const sixth = await postLogin(locked, password);
  expect(sixth.statusCode).toBe(429);
  expect(sixth.headers["set-cookie"]).toBeUndefined();
});

test("a session cookie does not open /v1/logins and an api key does not open /ringkasan", async () => {
  const cookie = cookieOf(await postLogin(app, password));
  expect((await app.inject({ url: "/v1/logins", headers: { cookie } })).statusCode).toBe(401);
  const withKey = await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", "x-api-key": apiKey } });
  expect(withKey.statusCode).toBe(302);
});

test("POST with a foreign Origin, or with no Origin and no Sec-Fetch-Site, is 403; Sec-Fetch-Site same-origin passes", async () => {
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", origin: "http://evil.example" })).statusCode).toBe(403);
  expect((await postLogin(app, password, { host: "127.0.0.1:3000" })).statusCode).toBe(403);
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" })).statusCode).toBe(403);
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin" })).statusCode).toBe(303);
});

test("a Host header other than 127.0.0.1 or localhost is 421", async () => {
  expect((await app.inject({ url: "/login", headers: { host: "evil.example:3000" } })).statusCode).toBe(421);
  expect((await postLogin(app, password, { host: "evil.example:3000", origin: "http://evil.example:3000" })).statusCode).toBe(421);
});

test("localhost and 127.0.0.1 both work", async () => {
  expect((await postLogin(app, password, { host: "localhost:3000", origin: "http://localhost:3000" })).statusCode).toBe(303);
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })).statusCode).toBe(303);
});

test("an unknown or stale cookie (API restarted) redirects to /login", async () => {
  const res = await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie: `ops_session=${"a".repeat(64)}` } });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe("/login");
});

test("changing the password ends sessions created before it", async () => {
  const cookie = cookieOf(await postLogin(app, password));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await setUiPassword(db, "kata sandi panjang 2");
  expect((await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie } })).statusCode).toBe(302);
  await setUiPassword(db, password);
});

test("a session idle for more than 8 hours expires (fake clock)", async () => {
  let now = Date.now() + 1000;
  const idle = makeApp({ sessions: createSessionStore({ now: () => now }) });
  const cookie = cookieOf(await postLogin(idle, password));
  now += 7 * 60 * 60 * 1000;
  expect((await idle.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie } })).statusCode).toBe(200);
  now += 8 * 60 * 60 * 1000 + 1;
  expect((await idle.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie } })).statusCode).toBe(302);
});

test("web responses carry the security headers", async () => {
  const res = await app.inject({ url: "/login", headers: { host: "127.0.0.1:3000" } });
  expect(res.headers["content-security-policy"]).toBe(
    "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["referrer-policy"]).toBe("same-origin");
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
});

test("safeReturnPath keeps /paket?login=a and rejects //evil.com, https://evil.com and javascript:x", () => {
  expect(safeReturnPath("/paket?login=a")).toBe("/paket?login=a");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:x", "", undefined, 42]) {
    expect(safeReturnPath(bad)).toBe("/ringkasan");
  }
});

test("logout clears the session", async () => {
  const cookie = cookieOf(await postLogin(app, password));
  const res = await app.inject({ method: "POST", url: "/logout", headers: { ...form, ...sameOrigin, cookie }, payload: "" });
  expect(res.statusCode).toBe(303);
  expect(res.headers.location).toBe("/login");
  expect(String(res.headers["set-cookie"])).toContain("Max-Age=0");
  expect((await app.inject({ url: "/ringkasan", headers: { host: "127.0.0.1:3000", cookie } })).statusCode).toBe(302);
});

test("GET / goes to /ringkasan with a session", async () => {
  const cookie = cookieOf(await postLogin(app, password));
  const res = await app.inject({ url: "/", headers: { host: "127.0.0.1:3000", cookie } });
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe("/ringkasan");
});

test("a percent-encoded /v1 path still needs the API key, even with a session", async () => {
  const cookie = cookieOf(await postLogin(app, password));
  const res = await app.inject({ url: "/%76%31/logins", headers: { host: "127.0.0.1:3000", cookie } });
  expect(res.statusCode).toBe(401);
  expect(res.body).not.toContain("logins\":[");
});

test("parallel wrong guesses cannot get past the five-attempt limit", async () => {
  const target = makeApp({ throttle: createLoginThrottle() });
  const results = await Promise.all(Array.from({ length: 12 }, () => postLogin(target, "tebakan salah sekali")));
  expect(results.filter((r) => r.statusCode === 401).length).toBeLessThanOrEqual(5);
  expect(results.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(7);
});

test("an Origin on another port or scheme of the same host is 403", async () => {
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:8080" })).statusCode).toBe(403);
  expect((await postLogin(app, password, { host: "127.0.0.1:3000", origin: "https://127.0.0.1:3000" })).statusCode).toBe(403);
  expect((await postLogin(app, password, { host: "localhost:3000", origin: "http://localhost" })).statusCode).toBe(403);
});
