import { Prisma, type PrismaClient } from "@ops/database";

export type JobRow = { id: string; kind: string; payload: unknown; attempts: number };

export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

const ACTIVE = ["QUEUED", "RUNNING"];

export async function enqueueJob(
  db: PrismaClient,
  input: { kind: string; payload: object; dedupeKey?: string },
): Promise<{ id: string; status: string; created: boolean }> {
  const findActive = () =>
    input.dedupeKey ? db.job.findFirst({ where: { dedupeKey: input.dedupeKey, status: { in: ACTIVE } } }) : null;

  const existing = await findActive();
  if (existing) return { id: existing.id, status: existing.status, created: false };
  try {
    const job = await db.job.create({
      data: { kind: input.kind, payload: input.payload, dedupeKey: input.dedupeKey, runAfter: new Date() },
    });
    return { id: job.id, status: job.status, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await findActive();
      if (raced) return { id: raced.id, status: raced.status, created: false };
    }
    throw error;
  }
}

export async function claimNextJob(db: PrismaClient): Promise<JobRow | null> {
  // runAfter is written with this process's clock, so it is compared with the same clock: the Docker database clock
  // drifts seconds away from Windows. The ISO string is cast to a zone-less UTC timestamp, the column's format.
  const now = new Date().toISOString();
  const rows = await db.$queryRaw<JobRow[]>`
    UPDATE "jobs"
    SET "status" = 'RUNNING', "attempts" = "attempts" + 1,
        "startedAt" = ${now}::timestamp, "updatedAt" = ${now}::timestamp
    WHERE "id" = (
      SELECT "id" FROM "jobs"
      WHERE "status" = 'QUEUED' AND "runAfter" <= ${now}::timestamp
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id", "kind", "payload", "attempts"`;
  return rows[0] ?? null;
}

export async function completeJob(db: PrismaClient, id: string, result: object): Promise<void> {
  await db.job.update({ where: { id }, data: { status: "DONE", result, error: null, finishedAt: new Date() } });
}

export async function failJob(
  db: PrismaClient,
  job: JobRow,
  error: unknown,
  opts: { permanent?: boolean; retryDelayMs?: number } = {},
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const { maxAttempts } = await db.job.findUniqueOrThrow({ where: { id: job.id }, select: { maxAttempts: true } });
  if (opts.permanent || error instanceof PermanentJobError || job.attempts >= maxAttempts) {
    await db.job.update({ where: { id: job.id }, data: { status: "FAILED", error: message, finishedAt: new Date() } });
    return;
  }
  const delay = opts.retryDelayMs ?? 30_000 * job.attempts;
  await db.job.update({
    where: { id: job.id },
    data: { status: "QUEUED", error: message, runAfter: new Date(Date.now() + delay) },
  });
}

export async function recoverStaleJobs(db: PrismaClient): Promise<number> {
  const { count } = await db.job.updateMany({ where: { status: "RUNNING" }, data: { status: "QUEUED" } });
  return count;
}
