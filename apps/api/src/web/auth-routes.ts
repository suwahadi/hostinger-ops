import type { PrismaClient } from "@ops/database";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { getUiCredential, verifyPassword } from "../services/ui-password.js";
import { readCookie, SESSION_COOKIE } from "./guard.js";
import type { LoginThrottle, SessionStore } from "./session.js";

export type WebAuthDeps = { db: PrismaClient; sessions: SessionStore; throttle: LoginThrottle };

type LoginState = "form" | "setup" | "wrong" | "locked";

const MESSAGES: Record<LoginState, string> = {
  form: "",
  setup:
    "Belum ada password web. Buat dulu di terminal Anda sendiri (PowerShell): <code>corepack pnpm ops:ui:password</code>",
  wrong: "Password salah.",
  locked: "Terlalu banyak percobaan yang salah. Coba lagi 5 menit lagi.",
};

export function loginPage(state: LoginState): string {
  const message = MESSAGES[state] ? `<p class="notice" role="alert">${MESSAGES[state]}</p>` : "";
  const formHtml =
    state === "setup"
      ? ""
      : `<form method="post" action="/login" class="login-form">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Masuk</button>
</form>`;
  return `<!doctype html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk · Hostinger Ops</title><link rel="stylesheet" href="/assets/app.css"></head>
<body class="login-page"><main class="login-card"><h1>Hostinger Ops</h1>${message}${formHtml}</main></body>
</html>`;
}

export function webAuthRoutes({ db, sessions, throttle }: WebAuthDeps): FastifyPluginAsync {
  return async (app) => {
    const audit = (request: FastifyRequest, result: string) =>
      db.auditLog.create({
        data: { requestId: request.id, actor: "WEB_HUMAN", action: "UI_LOGIN", resource: "ui_credentials", result },
      });
    const sendLogin = (reply: FastifyReply, code: number, state: LoginState) =>
      reply.code(code).type("text/html; charset=utf-8").send(loginPage(state));

    app.get("/", async (_request, reply) => reply.redirect("/ringkasan", 302));

    app.get("/login", async (_request, reply) => sendLogin(reply, 200, (await getUiCredential(db)) ? "form" : "setup"));

    app.post<{ Body: Record<string, string> | undefined }>("/login", async (request, reply) => {
      const credential = await getUiCredential(db);
      if (!credential) return sendLogin(reply, 400, "setup");
      if (throttle.isLocked()) {
        await audit(request, "locked");
        return sendLogin(reply, 429, "locked");
      }
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (!(await verifyPassword(password, credential.passwordHash))) {
        throttle.recordFailure();
        await audit(request, "wrong_password");
        return sendLogin(reply, 401, "wrong");
      }
      throttle.reset();
      const token = sessions.create();
      await audit(request, "ok");
      return reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`).redirect("/ringkasan", 303);
    });

    app.post("/logout", async (request, reply) => {
      const token = readCookie(request.headers.cookie, SESSION_COOKIE);
      if (token) sessions.destroy(token);
      return reply
        .header("set-cookie", `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/`)
        .redirect("/login", 303);
    });
  };
}
