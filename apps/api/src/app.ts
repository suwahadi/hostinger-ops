import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@ops/database";
import { createRateLimiter, HOSTINGER_RATE_LIMIT, type RateLimiter, type Sleep } from "@ops/hostinger-adapter";
import { checkDomainExpiry, createRdap, type Rdap } from "@ops/worker";
import { fastify, type FastifyInstance } from "fastify";
import { inventoryRoutes } from "./routes/inventory.js";
import { syncRoutes } from "./routes/sync.js";
import { getUiCredential } from "./services/ui-password.js";
import { verifyLogin } from "./services/verify-login.js";
import { sessionEndedPage, webAuthRoutes } from "./web/auth-routes.js";
import { isAllowedHost, isSameOriginPost, readCookie, SECURITY_HEADERS, SESSION_COOKIE } from "./web/guard.js";
import { webActions } from "./web/actions.js";
import { errorPage, notFoundPage, webPages } from "./web/pages.js";
import { APP_JS } from "./web/script.js";
import { APP_CSS } from "./web/styles.js";
import { createLoginThrottle, createSessionStore, type LoginThrottle, type SessionStore } from "./web/session.js";

export type AppDeps = {
  db: PrismaClient;
  apiKey: string;
  masterKey: Buffer;
  logger?: boolean;
  fetch?: typeof fetch;
  limiter?: RateLimiter;
  sleep?: Sleep;
  sessions?: SessionStore;
  throttle?: LoginThrottle;
  rdap?: Rdap;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest();

const pathOf = (url: string) => url.split("?")[0]!;
const isApiPath = (path: string) => path === "/health" || path === "/v1" || path.startsWith("/v1/");
// /logout is public so "Keluar" still works after the session is gone (e.g. the API restarted).
const isPublicWebPath = (path: string) =>
  path === "/login" || path === "/logout" || path === "/favicon.ico" || path.startsWith("/assets/");

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, apiKey, masterKey, logger = false, fetch, limiter, sleep } = deps;
  const app = fastify({ logger, genReqId: () => randomUUID() });
  const expectedKey = sha256(apiKey);
  const hostingerLimiter = limiter ?? createRateLimiter(HOSTINGER_RATE_LIMIT);
  const sessions = deps.sessions ?? createSessionStore();
  const throttle = deps.throttle ?? createLoginThrottle();
  const rdap = deps.rdap ?? createRdap({ fetch });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 16 * 1024 }, (_request, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  // Two separate doors: /v1 opens only with the internal API key (Claude), web pages only with a browser session.
  app.addHook("onRequest", async (request, reply) => {
    // Classify by the route the router matched, not the raw URL: the router decodes "%76%31" to "v1",
    // so a raw-URL check would send an encoded /v1 request through the web door.
    const path = request.routeOptions.url ?? pathOf(request.url);
    if (path === "/health") return;
    if (isApiPath(path)) {
      const presented = request.headers["x-api-key"];
      // Hashing first gives both sides equal length, so timingSafeEqual never throws on a short key.
      if (typeof presented !== "string" || !timingSafeEqual(sha256(presented), expectedKey)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      return;
    }

    reply.headers(SECURITY_HEADERS);
    if (!isAllowedHost(request.headers.host)) return reply.code(421).type("text/plain").send("Misdirected request");
    if (request.method === "POST" && !isSameOriginPost(request.headers)) {
      return reply.code(403).type("text/plain").send("Forbidden");
    }
    if (isPublicWebPath(path)) return;

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const session = token ? sessions.get(token) : null;
    const credential = session ? await getUiCredential(db) : null;
    // A session that predates the current password belongs to the old password and is no longer valid.
    if (!session || !credential || session.createdAt <= credential.updatedAt.getTime()) {
      if (token) sessions.destroy(token);
      if (request.method === "GET") return reply.redirect("/login", 302);
      return reply.code(401).type("text/html; charset=utf-8").send(sessionEndedPage());
    }
  });

  const isWebRequest = (url: string) => !isApiPath(pathOf(url));

  app.setErrorHandler((error: { statusCode?: number }, request, reply) => {
    if (error.statusCode && error.statusCode < 500) return reply.code(error.statusCode).send({ error: "bad_request" });
    request.log.error(error);
    if (isWebRequest(request.url)) return reply.code(500).type("text/html; charset=utf-8").send(errorPage());
    return reply.code(500).send({ error: "internal_error" });
  });

  app.setNotFoundHandler((request, reply) =>
    isWebRequest(request.url)
      ? reply.code(404).type("text/html; charset=utf-8").send(notFoundPage())
      : reply.code(404).send({ error: "not_found" }),
  );

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
  app.register(syncRoutes(db), { prefix: "/v1" });
  app.register(webAuthRoutes({ db, sessions, throttle }));
  app.register(webPages(db));
  const webVerify = (alias: string, requestId: string) =>
    verifyLogin({ db, masterKey, limiter: hostingerLimiter, fetch, sleep, requestId, actor: "WEB_HUMAN" }, alias);
  const checkExpiry = (domain: string, requestId: string) =>
    checkDomainExpiry({ db, masterKey, limiter: hostingerLimiter, fetch, sleep, rdap, requestId, actor: "WEB_HUMAN" }, domain);
  app.register(webActions({ db, verify: webVerify, checkExpiry }));
  app.get("/assets/app.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(APP_CSS));
  app.get("/assets/app.js", async (_request, reply) => reply.type("text/javascript; charset=utf-8").send(APP_JS));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());
  return app;
}
