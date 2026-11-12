import type { HostingerClient, HostingerResult } from "./client.js";

const MAX_PAGES = 200;

export class HostingerRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostingerRequestError";
  }
}

const unexpectedShape = (path: string) =>
  new HostingerRequestError(`Hostinger GET ${path} returned an unexpected response shape`);

function bodyOf(path: string, result: HostingerResult): unknown {
  if (result.status !== 200) throw new HostingerRequestError(`Hostinger GET ${path} failed: ${result.status ?? result.error}`);
  return result.body;
}

export async function getAllPages(client: HostingerClient, path: string, perPage = 50): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = bodyOf(path, await client.get(path, { page, per_page: perPage })) as {
      data?: unknown;
      meta?: { total?: unknown };
    } | null;
    if (!body || !Array.isArray(body.data)) throw unexpectedShape(path);
    items.push(...body.data);
    const total = typeof body.meta?.total === "number" ? body.meta.total : undefined;
    // With a total, a short page proves nothing (Hostinger may cap per_page); only the count does.
    if (total !== undefined && items.length >= total) return items;
    if (total === undefined && body.data.length < perPage) return items;
    if (body.data.length === 0) {
      throw new HostingerRequestError(`Hostinger GET ${path} returned ${items.length} of ${total} items`);
    }
  }
  throw new HostingerRequestError(`Hostinger GET ${path} returned more than ${MAX_PAGES} pages`);
}

export async function getList(client: HostingerClient, path: string): Promise<unknown[]> {
  const body = bodyOf(path, await client.get(path));
  if (!Array.isArray(body)) throw unexpectedShape(path);
  return body;
}
