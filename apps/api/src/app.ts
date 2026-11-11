import { createHash, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@ops/database";
import { fastify, type FastifyInstance } from "fastify";
import { inventoryRoutes } from "./routes/inventory.js";

export type AppDeps = { db: PrismaClient; apiKey: string; logger?: boolean };

const sha256 = (value: string) => createHash("sha256").update(value).digest();

export function buildApp({ db, apiKey, logger = false }: AppDeps): FastifyInstance {
  const app = fastify({ logger });
  const expectedKey = sha256(apiKey);

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const presented = request.headers["x-api-key"];
    // Hashing first gives both sides equal length, so timingSafeEqual never throws on a short key.
    if (typeof presented !== "string" || !timingSafeEqual(sha256(presented), expectedKey)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: "bad_request" });
    request.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => {
    const database = await db.$queryRaw`SELECT 1`.then(
      () => "up",
      () => "down",
    );
    return { status: "ok", database };
  });

  app.register(inventoryRoutes(db), { prefix: "/v1" });
  return app;
}
