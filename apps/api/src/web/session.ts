import { createHash, randomBytes } from "node:crypto";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export type SessionStore = {
  create(): string;
  get(token: string): { createdAt: number } | null;
  destroy(token: string): void;
};

export type LoginThrottle = { isLocked(): boolean; recordFailure(): void; reset(): void };

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

// Sessions live in memory on purpose: one owner on one PC, and restarting the API simply asks for the password again.
export function createSessionStore(opts: { idleMs?: number; now?: () => number } = {}): SessionStore {
  const idleMs = opts.idleMs ?? 8 * HOUR;
  const now = opts.now ?? Date.now;
  const sessions = new Map<string, { createdAt: number; lastSeenAt: number }>();

  return {
    create() {
      const token = randomBytes(32).toString("hex");
      sessions.set(digest(token), { createdAt: now(), lastSeenAt: now() });
      return token;
    },
    get(token) {
      const key = digest(token);
      const session = sessions.get(key);
      if (!session) return null;
      if (now() - session.lastSeenAt > idleMs) {
        sessions.delete(key);
        return null;
      }
      session.lastSeenAt = now();
      return { createdAt: session.createdAt };
    },
    destroy(token) {
      sessions.delete(digest(token));
    },
  };
}

export function createLoginThrottle(
  opts: { maxFailures?: number; windowMs?: number; lockMs?: number; now?: () => number } = {},
): LoginThrottle {
  const { maxFailures = 5, windowMs = 15 * MINUTE, lockMs = 5 * MINUTE } = opts;
  const now = opts.now ?? Date.now;
  let failures: number[] = [];
  let lockedUntil = 0;

  return {
    isLocked: () => now() < lockedUntil,
    recordFailure() {
      failures = [...failures.filter((at) => now() - at < windowMs), now()];
      if (failures.length >= maxFailures) {
        lockedUntil = now() + lockMs;
        failures = [];
      }
    },
    reset() {
      failures = [];
      lockedUntil = 0;
    },
  };
}
