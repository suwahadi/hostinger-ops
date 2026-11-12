import { expect, test } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test("lets 90 calls through, then waits until the oldest leaves the window", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ limit: 90, windowMs: 60_000, ...clock });
  for (let i = 0; i < 90; i++) await limiter.acquire("login-a");
  expect(clock.now()).toBe(0);
  await limiter.acquire("login-a");
  expect(clock.now()).toBe(60_000);
});

test("keeps a separate budget per key", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, ...clock });
  await limiter.acquire("a");
  await limiter.acquire("b");
  expect(clock.now()).toBe(0);
});
