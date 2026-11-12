export type Sleep = (ms: number) => Promise<void>;

export type RateLimiter = { acquire(key: string): Promise<void> };

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In-memory is enough: the API and the worker run in one process (apps/api/src/server.ts) and share one limiter.
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
  sleep?: Sleep;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const callsByKey = new Map<string, number[]>();

  return {
    async acquire(key) {
      const calls = callsByKey.get(key) ?? [];
      callsByKey.set(key, calls);
      for (;;) {
        const windowStart = now() - opts.windowMs;
        while (calls.length > 0 && calls[0]! <= windowStart) calls.shift();
        if (calls.length < opts.limit) {
          calls.push(now());
          return;
        }
        await sleep(calls[0]! + opts.windowMs - now());
      }
    },
  };
}
