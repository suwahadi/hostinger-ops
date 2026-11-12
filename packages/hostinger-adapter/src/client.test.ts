import { expect, test, vi } from "vitest";
import { createHostingerClient, type HostingerCall } from "./client.js";

const token = "tok-rahasia-123";
const noLimit = { acquire: async () => {} };
const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("sends the bearer token to the Hostinger base URL with query params", async () => {
  const fetchMock = vi.fn(async () => json(200, { data: [] }));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock });
  const result = await client.get("/api/hosting/v1/websites", { per_page: 1 });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://developers.hostinger.com/api/hosting/v1/websites?per_page=1");
  expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
  expect(result).toEqual({ status: 200, error: null, body: { data: [] } });
});

test.each([
  [{ "retry-after": "2" }, 2_000],
  [{}, 60_000],
  [{ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, 60_000],
  [{ "retry-after": "600" }, 60_000],
])("429 with %o waits %i ms and retries", async (headers, waited) => {
  const sleep = vi.fn(async () => {});
  const fetchMock = vi.fn().mockResolvedValueOnce(json(429, {}, headers)).mockResolvedValueOnce(json(200));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock, sleep });
  expect((await client.get("/x")).status).toBe(200);
  expect(sleep).toHaveBeenCalledWith(waited);
});

test("gives up after 3 attempts of 429", async () => {
  const fetchMock = vi.fn(async () => json(429, {}, { "retry-after": "1" }));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock, sleep: async () => {} });
  expect((await client.get("/x")).status).toBe(429);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test.each([
  [Object.assign(new Error("t"), { name: "TimeoutError" }), "timeout"],
  [new TypeError(`fetch failed for Bearer ${token}`), "network_error"],
])("maps a thrown fetch error %# to its kind without echoing it", async (thrown, kind) => {
  const calls: HostingerCall[] = [];
  const client = createHostingerClient({
    token,
    limiterKey: "a",
    limiter: noLimit,
    fetch: async () => {
      throw thrown;
    },
    onCall: async (c) => {
      calls.push(c);
    },
  });
  expect(await client.get("/x")).toEqual({ status: null, error: kind, body: null });
  expect(JSON.stringify(calls)).not.toContain(token);
});

test("reports every attempt to onCall without the token", async () => {
  const calls: HostingerCall[] = [];
  const fetchMock = vi.fn().mockResolvedValueOnce(json(429, {}, { "retry-after": "1" })).mockResolvedValueOnce(json(200));
  const client = createHostingerClient({
    token,
    limiterKey: "a",
    limiter: noLimit,
    fetch: fetchMock,
    sleep: async () => {},
    onCall: async (c) => {
      calls.push(c);
    },
  });
  await client.get("/api/hosting/v1/orders", { per_page: 1 });
  expect(calls.map((c) => [c.path, c.status, c.attempt])).toEqual([
    ["/api/hosting/v1/orders", 429, 1],
    ["/api/hosting/v1/orders", 200, 2],
  ]);
});

test("acquires the limiter with the login key before each attempt", async () => {
  const acquire = vi.fn(async () => {});
  const client = createHostingerClient({ token, limiterKey: "login-a", limiter: { acquire }, fetch: async () => json(200) });
  await client.get("/x");
  expect(acquire).toHaveBeenCalledWith("login-a");
});
