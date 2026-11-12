import type { PrismaClient } from "@ops/database";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requestSync } from "../services/sync-request.js";

const SyncBody = z.object({ login: z.string().optional() });

export function syncRoutes(db: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.post("/sync", async (request, reply) => {
      const body = SyncBody.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid_body" });
      const result = await requestSync(db, { login: body.data.login, actor: "CLAUDE_MCP", requestId: request.id });
      if (!result) return reply.code(404).send({ error: "login_not_found" });
      return result;
    });
  };
}
