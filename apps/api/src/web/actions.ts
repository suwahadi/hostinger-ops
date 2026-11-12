import type { PrismaClient } from "@ops/database";
import type { FastifyPluginAsync } from "fastify";
import { requestSync } from "../services/sync-request.js";
import type { VerifyResult } from "../services/verify-login.js";
import { safeReturnPath } from "./guard.js";

type Form = Record<string, string> | undefined;

const field = (body: Form, name: string) => (typeof body?.[name] === "string" ? body[name]!.trim() : "");

function withMessage(path: string, message: string): string {
  const url = new URL(path, "http://local");
  url.searchParams.set("pesan", message);
  return `${url.pathname}${url.search}`;
}

export function webActions(deps: {
  db: PrismaClient;
  verify: (alias: string, requestId: string) => Promise<VerifyResult | null>;
}): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: Form }>("/aksi/sinkron", async (request, reply) => {
      const login = field(request.body, "login");
      const back = safeReturnPath(request.body?.kembali);
      const result = await requestSync(deps.db, { login: login || undefined, actor: "WEB_HUMAN", requestId: request.id });
      let message: string;
      if (!result) message = `Login ${login} tidak ditemukan.`;
      else if (result.jobs.length === 0) message = "Belum ada login untuk disinkronkan.";
      else if (login) {
        message = result.jobs[0]!.created
          ? `Sinkronisasi untuk ${login} diantrekan. Hasilnya muncul di Sinkron & Audit dalam beberapa detik.`
          : `Sinkronisasi untuk ${login} sudah dalam antrean.`;
      } else {
        const created = result.jobs.filter((j) => j.created).length;
        const waiting = result.jobs.length - created;
        message = `Sinkronisasi diantrekan untuk ${created} login${waiting ? `; ${waiting} login sudah dalam antrean` : ""}.`;
      }
      return reply.redirect(withMessage(back, message), 303);
    });

    app.post<{ Body: Form }>("/aksi/uji", async (request, reply) => {
      const login = field(request.body, "login");
      const back = safeReturnPath(request.body?.kembali);
      const result = login ? await deps.verify(login, request.id) : null;
      const message = result
        ? `${login}: ${result.login.status}.${result.hint ? ` ${result.hint}` : ""}`
        : `Login ${login || "(kosong)"} tidak ditemukan.`;
      return reply.redirect(withMessage(back, message), 303);
    });
  };
}
