import { expect, test } from "vitest";
import { createRdap } from "./rdap.js";

const BOOTSTRAP = {
  services: [
    [["com", "net"], ["https://rdap.contoh-registry.test/com/v1/"]],
    [["id"], ["https://rdap.registry-id.test/rdap"]],
    [["lama"], ["http://rdap.tanpa-tls.test/"]],
  ],
};

function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: { url: string; accept: string | null }[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, accept: new Headers(init?.headers).get("accept") });
    if (url === "https://data.iana.org/rdap/dns.json") return Response.json(BOOTSTRAP);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return Response.json(route.body ?? {}, { status: route.status });
  }) as typeof fetch;
  return { fn, calls };
}

test("asks the registry named in the IANA bootstrap and reads the expiration event", async () => {
  const { fn, calls } = fakeFetch({
    "https://rdap.contoh-registry.test/com/v1/domain/contoh.com": {
      status: 200,
      body: { events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }, { eventAction: "expiration", eventDate: "2027-05-06T00:00:00Z" }] },
    },
  });
  const answer = await createRdap({ fetch: fn }).lookup("contoh.com");
  expect(answer).toEqual({ kind: "found", expiresAt: new Date("2027-05-06T00:00:00Z"), server: "rdap.contoh-registry.test" });
  expect(calls.at(-1)!.accept).toContain("application/rdap+json");
});

test("a server URL without a trailing slash still gets one; .co.id goes to the .id registry", async () => {
  const { fn, calls } = fakeFetch({
    "https://rdap.registry-id.test/rdap/domain/contoh.co.id": { status: 200, body: { events: [{ eventAction: "expiration", eventDate: "2026-12-01T00:00:00Z" }] } },
  });
  const answer = await createRdap({ fetch: fn }).lookup("contoh.co.id");
  expect(answer).toMatchObject({ kind: "found", expiresAt: new Date("2026-12-01T00:00:00Z") });
  expect(calls.at(-1)!.url).toBe("https://rdap.registry-id.test/rdap/domain/contoh.co.id");
});

test("404 is not_found, a TLD without an https server is unsupported, and other statuses are errors", async () => {
  const { fn, calls } = fakeFetch({ "https://rdap.contoh-registry.test/com/v1/domain/sibuk.com": { status: 503 } });
  const rdap = createRdap({ fetch: fn });
  expect(await rdap.lookup("tidak-ada.com")).toEqual({ kind: "not_found", server: "rdap.contoh-registry.test" });
  expect(await rdap.lookup("contoh.lama")).toEqual({ kind: "unsupported" });
  expect(await rdap.lookup("contoh.antah")).toEqual({ kind: "unsupported" });
  expect(await rdap.lookup("sibuk.com")).toEqual({ kind: "error", server: "rdap.contoh-registry.test", reason: "HTTP 503" });
  expect(calls.some((c) => c.url.includes("tanpa-tls"))).toBe(false);
});

test("the bootstrap is fetched once and reused until it is a day old", async () => {
  const { fn, calls } = fakeFetch({});
  let clock = 0;
  const rdap = createRdap({ fetch: fn, now: () => clock });
  await rdap.lookup("satu.com");
  await rdap.lookup("dua.com");
  clock += 25 * 60 * 60 * 1000;
  await rdap.lookup("tiga.com");
  expect(calls.filter((c) => c.url.includes("data.iana.org"))).toHaveLength(2);
});

test("a registered domain without an expiration event is found with no date", async () => {
  const { fn } = fakeFetch({ "https://rdap.contoh-registry.test/com/v1/domain/rahasia.com": { status: 200, body: { events: [] } } });
  expect(await createRdap({ fetch: fn }).lookup("rahasia.com")).toEqual({ kind: "found", expiresAt: null, server: "rdap.contoh-registry.test" });
});
