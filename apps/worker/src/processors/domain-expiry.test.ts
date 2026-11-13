import { randomUUID } from "node:crypto";
import { createTestDb } from "@ops/database/test-db";
import { encryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import type { RdapAnswer } from "../rdap.js";
import { checkDomainExpiries, checkDomainExpiry, expiryGaps, registrableCandidates } from "./domain-expiry.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
const token = "tok-rahasia-456";
afterAll(() => db.$disconnect());

const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret(token, key) } });

function hostingerRenewal(byDomain: Record<string, { status: number; body?: unknown }>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    const name = decodeURIComponent(pathname.match(/^\/api\/domains\/v1\/portfolio\/([^/]+)\/renewal$/)?.[1] ?? "");
    const route = byDomain[name];
    const authorized = new Headers(init?.headers).get("authorization") === `Bearer ${token}`;
    if (!route || !authorized) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(route.body ?? {}), { status: route.status });
  });
}

function registry(answers: Record<string, RdapAnswer>) {
  return { lookup: vi.fn(async (name: string): Promise<RdapAnswer> => answers[name] ?? { kind: "not_found", server: "rdap.test" }) };
}

const deps = (fetch: typeof globalThis.fetch, rdap: ReturnType<typeof registry>, sleep = vi.fn(async () => {})) => ({
  db,
  masterKey: key,
  limiter: { acquire: async () => {} },
  sleep,
  fetch,
  rdap,
  requestId: randomUUID(),
  actor: "WEB_HUMAN" as const,
});

test("candidates run from the full name down to the registered name, never a bare .id zone like co.id", () => {
  expect(registrableCandidates("www.contoh.com")).toEqual(["www.contoh.com", "contoh.com"]);
  expect(registrableCandidates("blog.contoh.co.id")).toEqual(["blog.contoh.co.id", "contoh.co.id"]);
  expect(registrableCandidates("contoh.id")).toEqual(["contoh.id"]);
});

test("a domain in a connected account is read from Hostinger's renewal endpoint with that login's token", async () => {
  await db.domain.create({ data: { name: "milik.com", loginId: sumber.id, status: "active" } });
  const rdap = registry({});
  const check = await checkDomainExpiry(
    deps(hostingerRenewal({ "milik.com": { status: 200, body: { domain: "milik.com", status: "active", expires_at: "2027-02-02T00:00:00Z" } } }), rdap),
    "www.milik.com",
  );
  expect(check).toEqual({ outcome: "found", domain: "milik.com", expiresAt: new Date("2027-02-02T00:00:00Z"), source: "HOSTINGER" });
  expect(rdap.lookup).not.toHaveBeenCalled();
  const row = await db.domain.findUniqueOrThrow({ where: { name: "milik.com" } });
  expect(row).toMatchObject({ expiresAt: new Date("2027-02-02T00:00:00Z"), expirySource: "HOSTINGER", loginId: sumber.id });
  expect(row.expiryCheckedAt).toBeInstanceOf(Date);
  const audit = await db.auditLog.findMany({ where: { resourceId: "www.milik.com" } });
  expect(audit.map((a) => `${a.actor}:${a.action}:${a.result}`)).toContain("WEB_HUMAN:DOMAIN_EXPIRY_CHECK:found");
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(token);
});

test("a domain outside the accounts goes to RDAP; a subdomain falls back to its registered parent", async () => {
  const rdap = registry({ "luar.co.id": { kind: "found", expiresAt: new Date("2026-12-24T00:00:00Z"), server: "rdap.registry-id.test" } });
  const check = await checkDomainExpiry(deps(hostingerRenewal({}), rdap), "blog.luar.co.id");
  expect(check).toEqual({ outcome: "found", domain: "luar.co.id", expiresAt: new Date("2026-12-24T00:00:00Z"), source: "RDAP" });
  expect(rdap.lookup.mock.calls.map(([name]) => name)).toEqual(["blog.luar.co.id", "luar.co.id"]);
  expect(await db.domain.findUniqueOrThrow({ where: { name: "luar.co.id" } })).toMatchObject({ loginId: null, expirySource: "RDAP" });
  expect(await db.auditLog.count({ where: { resourceId: "blog.luar.co.id", action: "RDAP_LOOKUP" } })).toBe(2);
});

test("when Hostinger's renewal call fails, the registry is asked instead", async () => {
  await db.domain.create({ data: { name: "gagal.com", loginId: sumber.id } });
  const rdap = registry({ "gagal.com": { kind: "found", expiresAt: new Date("2027-07-07T00:00:00Z"), server: "rdap.test" } });
  const check = await checkDomainExpiry(deps(hostingerRenewal({ "gagal.com": { status: 422 } }), rdap), "gagal.com");
  expect(check).toMatchObject({ outcome: "found", source: "RDAP" });
});

test("temporary Hostinger addresses and odd names are never looked up", async () => {
  const rdap = registry({});
  expect(await checkDomainExpiry(deps(hostingerRenewal({}), rdap), "situs-coba.hostingersite.com")).toEqual({ outcome: "temporary" });
  expect(await checkDomainExpiry(deps(hostingerRenewal({}), rdap), "x@evil.com")).toEqual({ outcome: "invalid" });
  expect(rdap.lookup).not.toHaveBeenCalled();
});

test("a registry error is reported and nothing is stored; a TLD without RDAP is not_found", async () => {
  const failing = registry({ "sibuk.com": { kind: "error", server: "rdap.test", reason: "HTTP 503" } });
  expect(await checkDomainExpiry(deps(hostingerRenewal({}), failing), "sibuk.com")).toEqual({ outcome: "error", reason: "rdap.test: HTTP 503" });
  expect(await db.domain.findUnique({ where: { name: "sibuk.com" } })).toBeNull();
  const noRdap = registry({ "contoh.antah": { kind: "unsupported" } });
  expect(await checkDomainExpiry(deps(hostingerRenewal({}), noRdap), "contoh.antah")).toEqual({ outcome: "not_found" });
  expect(await db.domain.findUnique({ where: { name: "contoh.antah" } })).toBeNull();
});

test("a name the registry does not know at any level is recorded as not registered, replacing a stale date", async () => {
  await db.domain.create({ data: { name: "lepas.com", expiresAt: new Date("2025-01-01T00:00:00Z"), expirySource: "HOSTINGER" } });
  const check = await checkDomainExpiry(deps(hostingerRenewal({}), registry({})), "www.lepas.com");
  expect(check).toEqual({ outcome: "not_registered", domain: "lepas.com" });
  const row = await db.domain.findUniqueOrThrow({ where: { name: "lepas.com" } });
  expect(row).toMatchObject({ expiresAt: null, expirySource: "RDAP" });
  expect(row.expiryCheckedAt).toBeInstanceOf(Date);
});

test("the bulk job checks each website without a date once per registered domain, pausing between checks", async () => {
  const account = await db.hostingAccount.create({ data: { code: "9001", loginId: sumber.id } });
  await db.domain.create({ data: { name: "punya.com", expiresAt: new Date("2027-01-01T00:00:00Z") } });
  await db.website.createMany({
    data: [
      { accountId: account.id, domain: "punya.com" },
      { accountId: account.id, domain: "a.dobel.com" },
      { accountId: account.id, domain: "b.dobel.com" },
      { accountId: account.id, domain: "coba.hostingersite.com" },
      { accountId: account.id, domain: "hilang.com", status: "UNKNOWN" },
      { accountId: account.id, domain: "lepas.com" },
    ],
  });
  const gaps = await expiryGaps(db);
  const pending = gaps.unknown;
  expect(pending).toEqual(expect.arrayContaining(["a.dobel.com", "b.dobel.com"]));
  expect(pending).not.toEqual(expect.arrayContaining(["punya.com"]));
  expect(pending.some((d) => d.endsWith("hostingersite.com") || d === "hilang.com" || d === "lepas.com")).toBe(false);
  expect(gaps.notRegistered).toEqual(["lepas.com"]);

  const rdap = registry({ "dobel.com": { kind: "found", expiresAt: new Date("2027-03-03T00:00:00Z"), server: "rdap.test" } });
  const sleep = vi.fn(async () => {});
  const result = await checkDomainExpiries(deps(hostingerRenewal({}), rdap, sleep), { id: randomUUID(), kind: "check-domain-expiry", attempts: 1, payload: {} });
  expect(rdap.lookup.mock.calls.map(([name]) => name)).not.toContain("b.dobel.com");
  expect(result).toMatchObject({ pending: pending.length, found: 1 });
  expect(sleep).toHaveBeenCalledTimes(result.checked - 1);
  expect(await db.auditLog.count({ where: { action: "DOMAIN_EXPIRY_CHECK", actor: "WORKER" } })).toBe(result.checked);
});
