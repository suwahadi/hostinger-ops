import type { PrismaClient } from "@ops/database";
import { enqueueJob } from "@ops/worker";
import { syncDedupeKey } from "./summaries.js";

export type SyncRequestResult = { jobs: { id: string; status: string; created: boolean; login: string }[] };

export async function requestSync(
  db: PrismaClient,
  input: { login?: string; actor: "CLAUDE_MCP" | "WEB_HUMAN"; requestId: string },
): Promise<SyncRequestResult | null> {
  const logins = await db.hostingerLogin.findMany({
    where: input.login ? { alias: input.login } : {},
    orderBy: { alias: "asc" },
  });
  if (input.login && logins.length === 0) return null;
  const jobs: SyncRequestResult["jobs"] = [];
  for (const login of logins) {
    const job = await enqueueJob(db, { kind: "sync-login", payload: { loginId: login.id }, dedupeKey: syncDedupeKey(login.id) });
    await db.auditLog.create({
      data: {
        requestId: input.requestId,
        actor: input.actor,
        action: "SYNC_REQUEST",
        resource: "hostinger_login",
        resourceId: login.alias,
        result: job.created ? "queued" : "already_queued",
      },
    });
    jobs.push({ ...job, login: login.alias });
  }
  return { jobs };
}
