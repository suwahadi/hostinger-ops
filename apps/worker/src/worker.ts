import type { PrismaClient } from "@ops/database";
import { claimNextJob, completeJob, failJob, PermanentJobError, recoverStaleJobs, type JobRow } from "./queue.js";

export type JobHandler = (job: JobRow) => Promise<object>;

export function startWorker(opts: {
  db: PrismaClient;
  handlers: Record<string, JobHandler>;
  concurrency?: number;
  pollMs?: number;
  log?: (message: string) => void;
}): { stop(): Promise<void> } {
  const { db, handlers, concurrency = 3, pollMs = 2000, log = () => {} } = opts;
  const running = new Set<Promise<void>>();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

  async function runJob(job: JobRow) {
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new PermanentJobError(`No handler for job kind ${job.kind}`);
      await completeJob(db, job.id, await handler(job));
    } catch (error) {
      log(`Job ${job.id} (${job.kind}) failed: ${describe(error)}`);
      await failJob(db, job, error).catch((e) => log(`Could not record failure of job ${job.id}: ${describe(e)}`));
    }
  }

  async function tick() {
    try {
      while (!stopping && running.size < concurrency) {
        const job = await claimNextJob(db);
        if (!job) break;
        const run: Promise<void> = runJob(job).finally(() => running.delete(run));
        running.add(run);
      }
    } catch (error) {
      log(`Worker poll failed: ${describe(error)}`);
    }
    if (!stopping) timer = setTimeout(() => (pending = tick()), pollMs);
  }

  // One worker per PC: anything still RUNNING was interrupted (sleep, crash, restart) and is safe to run again.
  let pending: Promise<void> = recoverStaleJobs(db).then(
    (count) => {
      if (count > 0) log(`Re-queued ${count} interrupted job(s)`);
      return tick();
    },
    (error) => {
      log(`Could not re-queue interrupted jobs: ${describe(error)}`);
      return tick();
    },
  );

  return {
    async stop() {
      stopping = true;
      clearTimeout(timer);
      await pending;
      await Promise.allSettled([...running]);
    },
  };
}
