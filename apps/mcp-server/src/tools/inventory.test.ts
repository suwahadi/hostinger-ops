import { expect, test, vi } from "vitest";
import { createApiClient } from "../client.js";
import { inventoryTools, type InventoryTool } from "./inventory.js";

const apiUrl = "http://127.0.0.1:3000";
const tool = (tools: InventoryTool[], name: string) => tools.find((t) => t.name === name)!;
const toolsWith = (fetch: typeof globalThis.fetch) => inventoryTools(createApiClient({ apiUrl, apiKey: "k", fetch }));

test("registers the inventory tools", () => {
  expect(toolsWith(fetch).map((t) => t.name).sort()).toEqual([
    "get_login_capabilities",
    "list_accounts",
    "list_logins",
    "list_websites",
    "verify_login_connection",
  ]);
});

test("verify_login_connection posts to the verify route", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ login: { alias: "sumber", status: "CONNECTED" } })));
  const result = await tool(toolsWith(fetchMock), "verify_login_connection").handler({ login: "sumber" });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe("http://127.0.0.1:3000/v1/logins/sumber/verify");
  expect(init.method).toBe("POST");
  expect(new Headers(init.headers).get("x-api-key")).toBe("k");
  expect(JSON.parse(result.content[0]!.text).login.status).toBe("CONNECTED");
});

test("verify_login_connection requires a login", () => {
  expect(tool(toolsWith(fetch), "verify_login_connection").inputSchema.safeParse({}).success).toBe(false);
});

test("a slow verify reports its own timeout length", async () => {
  const timeout = async () => {
    throw Object.assign(new Error("t"), { name: "TimeoutError" });
  };
  const result = await tool(toolsWith(timeout), "verify_login_connection").handler({ login: "sumber" });
  expect(result.content[0]!.text).toBe("Hostinger Ops API did not respond within 180 seconds");
});

test("list_websites forwards filters, the key, and returns JSON text", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ websites: [{ domain: "contoh.com" }] })));
  const result = await tool(toolsWith(fetchMock), "list_websites").handler({ domain: "contoh" });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe("http://127.0.0.1:3000/v1/websites?domain=contoh");
  expect(new Headers(init.headers).get("x-api-key")).toBe("k");
  expect(JSON.parse(result.content[0]!.text).websites[0].domain).toBe("contoh.com");
});

test("get_login_capabilities encodes the alias into the path", async () => {
  const fetchMock = vi.fn(async () => new Response("{}"));
  await tool(toolsWith(fetchMock), "get_login_capabilities").handler({ login: "a/b" });
  expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("http://127.0.0.1:3000/v1/logins/a%2Fb/capabilities");
});

test("API down becomes a readable tool error", async () => {
  const result = await tool(toolsWith(async () => { throw new TypeError("fetch failed"); }), "list_logins").handler({});
  expect(result).toEqual({
    isError: true,
    content: [{ type: "text", text: "Hostinger Ops API is not running. Start it with: pnpm dev:api" }],
  });
});

test.each([
  [401, "Hostinger Ops API rejected the internal key"],
  [404, "Hostinger Ops API error (404)"],
  [500, "Hostinger Ops API error (500)"],
])("status %i becomes a tool error", async (status, text) => {
  const result = await tool(toolsWith(async () => new Response("{}", { status })), "list_logins").handler({});
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toBe(text);
});

test("get_login_capabilities requires a login", () => {
  expect(tool(toolsWith(fetch), "get_login_capabilities").inputSchema.safeParse({}).success).toBe(false);
});
