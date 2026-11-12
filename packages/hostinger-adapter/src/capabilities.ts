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

const skipped = (name: string, note: string): ProbeResult => ({ name, available: false, httpStatus: null, note });

export async function probeCapabilities(client: HostingerClient): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  let rateLimited = false;
  // Once the client has used up its 429 retries, further probes would only deepen the throttle (PRD §3.2: repeated violations can block the IP).
  const probe = async (name: string, path: string, query?: Record<string, number>) => {
    if (rateLimited) {
      results.push(skipped(name, "skipped: rate limited"));
      return undefined;
    }
    const result = await client.get(path, query);
    rateLimited = result.status === 429;
    results.push(toProbe(name, result));
    return result;
  };

  await probe("hosting.orders.list", "/api/hosting/v1/orders", { per_page: 1 });
  await probe("hosting.websites.list", "/api/hosting/v1/websites", { per_page: 1 });
  const portfolio = await probe("domains.portfolio.list", "/api/domains/v1/portfolio");
  const domain = portfolio && firstDomain(portfolio);
  if (domain) await probe("dns.zone.read", `/api/dns/v1/zones/${encodeURIComponent(domain)}`);
  else results.push(skipped("dns.zone.read", rateLimited ? "skipped: rate limited" : "no domain in portfolio to probe"));
  return results;
}
