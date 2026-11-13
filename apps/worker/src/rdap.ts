import { z } from "zod";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const HEADERS = { "User-Agent": "hostinger-ops" };

export type RdapAnswer =
  | { kind: "found"; expiresAt: Date | null; server: string }
  | { kind: "not_found"; server: string }
  | { kind: "unsupported" }
  | { kind: "error"; server: string | null; reason: string };

const Bootstrap = z.object({ services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])) });
const RdapDomain = z.object({ events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).optional() });

export function createRdap(opts: { fetch?: typeof fetch; now?: () => number } = {}) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let bootstrap: { loadedAt: number; services: [string[], string[]][] } | null = null;

  async function serverFor(name: string): Promise<string | null> {
    if (!bootstrap || now() - bootstrap.loadedAt > BOOTSTRAP_TTL_MS) {
      const response = await doFetch(BOOTSTRAP_URL, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`IANA RDAP bootstrap returned ${response.status}`);
      bootstrap = { loadedAt: now(), services: Bootstrap.parse(await response.json()).services };
    }
    const tld = name.slice(name.lastIndexOf(".") + 1);
    // Plain-http servers are skipped: the query would cross the network readable to anyone on the path.
    const base = bootstrap.services.find(([tlds]) => tlds.includes(tld))?.[1].find((url) => url.startsWith("https://"));
    return base ? (base.endsWith("/") ? base : `${base}/`) : null;
  }

  return {
    async lookup(name: string): Promise<RdapAnswer> {
      let server: string | null = null;
      try {
        server = await serverFor(name);
        if (!server) return { kind: "unsupported" };
        const host = new URL(server).host;
        const response = await doFetch(`${server}domain/${encodeURIComponent(name)}`, {
          headers: { ...HEADERS, Accept: "application/rdap+json, application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (response.status === 404) return { kind: "not_found", server: host };
        if (!response.ok) return { kind: "error", server: host, reason: `HTTP ${response.status}` };
        const parsed = RdapDomain.safeParse(await response.json().catch(() => null));
        if (!parsed.success) return { kind: "error", server: host, reason: "unexpected response" };
        const date = parsed.data.events?.find((e) => e.eventAction === "expiration")?.eventDate;
        const expiresAt = date && !Number.isNaN(Date.parse(date)) ? new Date(date) : null;
        return { kind: "found", expiresAt, server: host };
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
        return { kind: "error", server: server ? new URL(server).host : null, reason };
      }
    },
  };
}

export type Rdap = ReturnType<typeof createRdap>;
