import { expect, test } from "vitest";
import type { HostingerClient, HostingerResult } from "./client.js";
import { getAllPages, getList } from "./pages.js";

type Call = [string, Record<string, string | number> | undefined];

function pagedClient(itemsPerPage: Record<number, number>, total?: number) {
  const calls: Call[] = [];
  const sum = Object.values(itemsPerPage).reduce((a, b) => a + b, 0);
  const client: HostingerClient = {
    get: async (path, query) => {
      calls.push([path, query]);
      const count = itemsPerPage[Number(query?.page)] ?? 0;
      const data = Array.from({ length: count }, (_, i) => ({ i }));
      return { status: 200, error: null, body: { data, meta: { current_page: query?.page, per_page: 50, total: total ?? sum } } };
    },
  };
  return { client, calls };
}

const answering = (byPage: Record<number, HostingerResult>): HostingerClient => ({
  get: async (_path, query) => byPage[Number(query?.page ?? 0)] ?? { status: 200, error: null, body: { data: [], meta: {} } },
});

test("follows pages until a short page", async () => {
  const { client, calls } = pagedClient({ 1: 50, 2: 7 });
  expect(await getAllPages(client, "/api/hosting/v1/websites")).toHaveLength(57);
  expect(calls).toEqual([
    ["/api/hosting/v1/websites", { page: 1, per_page: 50 }],
    ["/api/hosting/v1/websites", { page: 2, per_page: 50 }],
  ]);
});

test("stops when page * per_page reaches meta.total", async () => {
  const { client, calls } = pagedClient({ 1: 50, 2: 50, 3: 50 }, 100);
  expect(await getAllPages(client, "/x")).toHaveLength(100);
  expect(calls).toHaveLength(2);
});

test("a failed page throws HostingerRequestError", async () => {
  const client = answering({
    1: { status: 200, error: null, body: { data: Array(50).fill({}), meta: { total: 60 } } },
    2: { status: 500, error: null, body: null },
  });
  await expect(getAllPages(client, "/x")).rejects.toThrow("Hostinger GET /x failed: 500");
});

test("a timeout reports its kind", async () => {
  const client = answering({ 1: { status: null, error: "timeout", body: null } });
  await expect(getAllPages(client, "/x")).rejects.toThrow("Hostinger GET /x failed: timeout");
});

test("a page without a data array is an unexpected shape", async () => {
  const client = answering({ 1: { status: 200, error: null, body: { items: [] } } });
  await expect(getAllPages(client, "/x")).rejects.toThrow("Hostinger GET /x returned an unexpected response shape");
});

test("getList returns an array body and rejects anything else", async () => {
  const list: HostingerClient = { get: async () => ({ status: 200, error: null, body: [{ id: "a" }] }) };
  expect(await getList(list, "/y")).toEqual([{ id: "a" }]);
  const notList: HostingerClient = { get: async () => ({ status: 200, error: null, body: { data: [] } }) };
  await expect(getList(notList, "/y")).rejects.toThrow("Hostinger GET /y returned an unexpected response shape");
  const denied: HostingerClient = { get: async () => ({ status: 403, error: null, body: null }) };
  await expect(getList(denied, "/y")).rejects.toThrow("Hostinger GET /y failed: 403");
});

test("keeps paging when Hostinger caps the page size below per_page", async () => {
  const { client, calls } = pagedClient({ 1: 20, 2: 20, 3: 17 }, 57);
  expect(await getAllPages(client, "/x")).toHaveLength(57);
  expect(calls).toHaveLength(3);
});

test("fewer items than meta.total is an error, not a complete list", async () => {
  const { client } = pagedClient({ 1: 20 }, 57);
  await expect(getAllPages(client, "/x")).rejects.toThrow("Hostinger GET /x returned 20 of 57 items");
});
