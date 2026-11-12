import type { HostingerClient, HostingerResult } from "./client.js";

export type ProbeResult = { name: string; available: boolean; httpStatus: number | null; note: string | null };

const NOTES_BY_STATUS: Record<number, string> = {
  401: "token rejected",
  403: "not permitted for this token",
  404: "not found",
  429: "rate limited",
};

function toProbe(name: string, result: HostingerResult): ProbeResult {
  if (result.error === "timeout") return { name, available: false, httpStatus: null, note: "timed out after 30s" };
  if (result.error === "network_error") return { name, available: false, httpStatus: null, note: "network error" };
  const status = result.status!;
  if (status === 200) return { name, available: true, httpStatus: 200, note: null };
  return { name, available: false, httpStatus: status, note: NOTES_BY_STATUS[status] ?? `HTTP ${status}` };
}

function firstDomain(portfolio: HostingerResult): string | undefined {
  if (portfolio.status !== 200 || !Array.isArray(portfolio.body)) return undefined;
  const domain = (portfolio.body[0] as { domain?: unknown } | undefined)?.domain;
  return typeof domain === "string" ? domain : undefined;
}

export async function probeCapabilities(client: HostingerClient): Promise<ProbeResult[]> {
  const orders = await client.get("/api/hosting/v1/orders", { per_page: 1 });
  const websites = await client.get("/api/hosting/v1/websites", { per_page: 1 });
  const portfolio = await client.get("/api/domains/v1/portfolio");
  const domain = firstDomain(portfolio);
  const dns = domain
    ? toProbe("dns.zone.read", await client.get(`/api/dns/v1/zones/${encodeURIComponent(domain)}`))
    : { name: "dns.zone.read", available: false, httpStatus: null, note: "no domain in portfolio to probe" };
  return [
    toProbe("hosting.orders.list", orders),
    toProbe("hosting.websites.list", websites),
    toProbe("domains.portfolio.list", portfolio),
    dns,
  ];
}
