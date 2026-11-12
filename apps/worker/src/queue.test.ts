import { createTestDb } from "@ops/database/test-db";
import { afterAll, expect, test } from "vitest";
import { claimNextJob, enqueueJob, failJob, PermanentJobError, recoverStaleJobs } from "./queue.js";

const db = await createTestDb();
afterAll(() => db.$disconnect());

test("enqueue twice with the same dedupe key returns the same active job", async () => {
  const a = await enqueueJob(db, { kind: "sync-login", payload: { loginId: "l1" }, dedupeKey: "sync-login:l1" });
  const b = await enqueueJob(db, { kind: "sync-login", payload: { loginId: "l1" }, dedupeKey: "sync-login:l1" });
  expect(a.created).toBe(true);
  expect(b).toEqual({ id: a.id, status: "QUEUED", created: false });
});

test("claim takes the oldest due job once", async () => {
  const job = await claimNextJob(db);
  expect(job).toMatchObject({ kind: "sync-login", payload: { loginId: "l1" }, attempts: 1 });
  expect(await claimNextJob(db)).toBeNull();
});

test("a job scheduled for later is not claimed yet", async () => {
  const { id } = await enqueueJob(db, { kind: "later", payload: {} });
  await db.job.update({ where: { id }, data: { runAfter: new Date(Date.now() + 60_000) } });
  expect(await claimNextJob(db)).toBeNull();
  await db.job.update({ where: { id }, data: { status: "DONE" } });
});

test("a failed job is retried later, then fails for good after maxAttempts", async () => {
  const { id } = await enqueueJob(db, { kind: "flaky", payload: {} });
  for (let i = 1; i <= 3; i++) {
    await db.job.update({ where: { id }, data: { runAfter: new Date(0) } });
    const job = (await claimNextJob(db))!;
    await failJob(db, job, new Error(`boom ${i}`));
    const row = await db.job.findUniqueOrThrow({ where: { id } });
    if (i < 3) expect(row).toMatchObject({ status: "QUEUED", error: `boom ${i}` });
    if (i < 3) expect(row.runAfter.getTime()).toBeGreaterThan(Date.now());
  }
  expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", attempts: 3, error: "boom 3" });
});

test("a permanent failure skips the retries", async () => {
  const { id } = await enqueueJob(db, { kind: "x", payload: {} });
  await failJob(db, (await claimNextJob(db))!, new PermanentJobError("no token"), { permanent: true });
  expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", error: "no token" });
});

test("stale RUNNING jobs go back to the queue", async () => {
  const { id } = await enqueueJob(db, { kind: "x2", payload: {} });
  await db.job.update({ where: { id }, data: { status: "RUNNING" } });
  expect(await recoverStaleJobs(db)).toBeGreaterThanOrEqual(1);
  expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("QUEUED");
});
