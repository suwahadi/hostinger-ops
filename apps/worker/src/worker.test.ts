import { createTestDb } from "@ops/database/test-db";
import { afterAll, expect, test, vi } from "vitest";
import { enqueueJob } from "./queue.js";
import { startWorker } from "./worker.js";

const db = await createTestDb();
afterAll(() => db.$disconnect());

const statusOf = async (id: string) => (await db.job.findUniqueOrThrow({ where: { id } })).status;

test("runs a queued job through its handler and stores the result", async () => {
  const { id } = await enqueueJob(db, { kind: "echo", payload: { n: 1 } });
  const worker = startWorker({ db, handlers: { echo: async (job) => ({ got: job.payload }) }, pollMs: 50 });
  await vi.waitFor(async () => expect(await statusOf(id)).toBe("DONE"), { timeout: 5000 });
  await worker.stop();
  expect((await db.job.findUniqueOrThrow({ where: { id } })).result).toEqual({ got: { n: 1 } });
});

test("a job with no handler fails permanently", async () => {
  const { id } = await enqueueJob(db, { kind: "unknown-kind", payload: {} });
  const worker = startWorker({ db, handlers: {}, pollMs: 50 });
  await vi.waitFor(async () => expect(await statusOf(id)).toBe("FAILED"), { timeout: 5000 });
  await worker.stop();
});

test("stop waits for a running job to finish", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { id } = await enqueueJob(db, { kind: "slow", payload: {} });
  const worker = startWorker({ db, handlers: { slow: async () => (await gate, {}) }, pollMs: 50 });
  await vi.waitFor(async () => expect(await statusOf(id)).toBe("RUNNING"), { timeout: 5000 });
  const stopped = worker.stop();
  release();
  await stopped;
  expect(await statusOf(id)).toBe("DONE");
});
