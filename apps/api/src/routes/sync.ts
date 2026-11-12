import type { PrismaClient } from "@ops/database";
import { enqueueJob } from "@ops/worker";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { syncDedupeKey } from "../services/summaries.js";

const SyncBody = z.object({ login: z.string().optional() });

export function syncRoutes(db: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.post("/sync", async (request, reply) => {
      const body = SyncBody.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });
      const logins = await db.hostingerLogin.findMany({
        where: body.data.login ? { alias: body.data.login } : {},
        orderBy: { alias: "asc" },
      });
      if (body.data.login && logins.length === 0) return reply.code(404).send({ error: "login_not_found" });
      const jobs = [];
      for (const login of logins) {
        const job = await enqueueJob(db, {
          kind: "sync-login",
          payload: { loginId: login.id },
          dedupeKey: syncDedupeKey(login.id),
        });
        jobs.push({ ...job, login: login.alias });
      }
      return { jobs };
    });
  };
}
