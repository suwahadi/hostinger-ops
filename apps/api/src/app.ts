import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@ops/database";
import { createRateLimiter, HOSTINGER_RATE_LIMIT, type RateLimiter, type Sleep } from "@ops/hostinger-adapter";
import { fastify, type FastifyInstance } from "fastify";
import { inventoryRoutes } from "./routes/inventory.js";
import { verifyLogin } from "./services/verify-login.js";

export type AppDeps = {
  db: PrismaClient;
  apiKey: string;
  masterKey: Buffer;
  logger?: boolean;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  sleep?: Sleep;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest();

export function buildApp({ db, apiKey, masterKey, logger = false, fetch, limiter, sleep }: AppDeps): FastifyInstance {
  const app = fastify({ logger, genReqId: () => randomUUID() });
  const expectedKey = sha256(apiKey);
  const hostingerLimiter = limiter ?? createRateLimiter(HOSTINGER_RATE_LIMIT);

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

  const verify = (alias: string, requestId: string) =>
    verifyLogin({ db, masterKey, limiter: hostingerLimiter, fetch, sleep, requestId }, alias);

  app.register(inventoryRoutes(db, verify), { prefix: "/v1" });
  return app;
}
