import { expect, test } from "vitest";
import { probeCapabilities } from "./capabilities.js";
import type { HostingerClient, HostingerResult } from "./client.js";

function fakeClient(byPath: Record<string, HostingerResult>) {
  const paths: string[] = [];
  const client: HostingerClient = {
    get: async (path) => {
      paths.push(path);
      return byPath[path] ?? { status: 404, error: null, body: null };
    },
  };
  return { client, paths };
}

const ok = (body: unknown = {}): HostingerResult => ({ status: 200, error: null, body });

test("probes the four read-only endpoints and uses the first portfolio domain for DNS", async () => {
  const { client, paths } = fakeClient({
    "/api/hosting/v1/orders": ok(),
    "/api/hosting/v1/websites": ok(),
    "/api/domains/v1/portfolio": ok([{ domain: "contoh.com" }]),
    "/api/dns/v1/zones/contoh.com": ok([]),
  });
  const results = await probeCapabilities(client);
  expect(paths).toEqual([
    "/api/hosting/v1/orders",
    "/api/hosting/v1/websites",
    "/api/domains/v1/portfolio",
    "/api/dns/v1/zones/contoh.com",
  ]);
  expect(results.map((r) => r.name)).toEqual([
    "hosting.orders.list",
    "hosting.websites.list",
    "domains.portfolio.list",
    "dns.zone.read",
  ]);
  expect(results.every((r) => r.available && r.httpStatus === 200 && r.note === null)).toBe(true);
});

test("skips the DNS probe when the portfolio is empty", async () => {
  const { client, paths } = fakeClient({ "/api/domains/v1/portfolio": ok([]) });
  expect((await probeCapabilities(client)).find((r) => r.name === "dns.zone.read")).toEqual({
    name: "dns.zone.read",
    available: false,
    httpStatus: null,
    note: "no domain in portfolio to probe",
  });
  expect(paths.some((p) => p.startsWith("/api/dns/"))).toBe(false);
});

test("skips the DNS probe when the portfolio request fails", async () => {
  const { client, paths } = fakeClient({});
  expect((await probeCapabilities(client)).find((r) => r.name === "dns.zone.read")?.note).toBe(
    "no domain in portfolio to probe",
  );
  expect(paths.some((p) => p.startsWith("/api/dns/"))).toBe(false);
});

test.each([
  [{ status: 401, error: null, body: null }, 401, "token rejected"],
  [{ status: 403, error: null, body: null }, 403, "not permitted for this token"],
  [{ status: 404, error: null, body: null }, 404, "not found"],
  [{ status: 429, error: null, body: null }, 429, "rate limited"],
  [{ status: 500, error: null, body: null }, 500, "HTTP 500"],
  [{ status: null, error: "timeout", body: null }, null, "timed out after 30s"],
  [{ status: null, error: "network_error", body: null }, null, "network error"],
])("maps %o to a note", async (result, httpStatus, note) => {
  const { client } = fakeClient({ "/api/hosting/v1/orders": result as HostingerResult });
  expect((await probeCapabilities(client))[0]).toEqual({ name: "hosting.orders.list", available: false, httpStatus, note });
});

test("stops probing once Hostinger keeps rate-limiting", async () => {
  const { client, paths } = fakeClient({ "/api/hosting/v1/orders": { status: 429, error: null, body: null } });
  const results = await probeCapabilities(client);
  expect(paths).toEqual(["/api/hosting/v1/orders"]);
  expect(results.map((r) => r.note)).toEqual([
    "rate limited",
    "skipped: rate limited",
    "skipped: rate limited",
    "skipped: rate limited",
  ]);
});
