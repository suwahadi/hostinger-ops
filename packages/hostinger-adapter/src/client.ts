import { defaultSleep, type RateLimiter, type Sleep } from "./rate-limiter.js";

export const HOSTINGER_BASE_URL = "https://developers.hostinger.com";
export const HOSTINGER_RATE_LIMIT = { limit: 90, windowMs: 60_000 };

const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 60_000;

export type HostingerResult = { status: number | null; error: "timeout" | "network_error" | null; body: unknown };

export type HostingerCall = {
  method: "GET";
  path: string;
  status: number | null;
  error: HostingerResult["error"];
  attempt: number;
  durationMs: number;
};

export type HostingerClient = { get(path: string, query?: Record<string, string | number>): Promise<HostingerResult> };

function retryAfterMs(header: string | null): number {
  const seconds = header !== null && /^\d+$/.test(header.trim()) ? Number(header) : Infinity;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

export function createHostingerClient(opts: {
  token: string;
  limiterKey: string;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  sleep?: Sleep;
  onCall?: (call: HostingerCall) => Promise<void>;
}): HostingerClient {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  return {
    async get(path, query = {}) {
      const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
      const url = `${HOSTINGER_BASE_URL}${path}${params.size > 0 ? `?${params}` : ""}`;
      let result: HostingerResult = { status: null, error: "network_error", body: null };

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await opts.limiter.acquire(opts.limiterKey);
        const started = Date.now();
        let response: Response | undefined;
        try {
          response = await doFetch(url, {
            headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/json", "User-Agent": "hostinger-ops" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          result = { status: response.status, error: null, body: await response.json().catch(() => null) };
        } catch (error) {
          // The thrown error is never forwarded: its message could carry request details, including the token.
          const kind = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
          result = { status: null, error: kind, body: null };
        }
        await opts.onCall?.({ method: "GET", path, status: result.status, error: result.error, attempt, durationMs: Date.now() - started });
        if (result.status !== 429 || attempt === MAX_ATTEMPTS) break;
        await sleep(retryAfterMs(response!.headers.get("retry-after")));
      }
      return result;
    },
  };
}
