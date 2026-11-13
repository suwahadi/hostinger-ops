import type { PrismaClient } from "@ops/database";
import { enqueueJob, type ExpiryCheck } from "@ops/worker";
import type { FastifyPluginAsync } from "fastify";
import { requestSync } from "../services/sync-request.js";
import type { VerifyResult } from "../services/verify-login.js";
import { setWebsiteExcluded } from "../services/website-exclusion.js";
import { formatDate } from "./format.js";
import { safeReturnPath } from "./guard.js";

type Form = Record<string, string> | undefined;

const field = (body: Form, name: string) => (typeof body?.[name] === "string" ? body[name]!.trim() : "");

function withMessage(path: string, message: string): string {
  const url = new URL(path, "http://local");
  url.searchParams.set("pesan", message);
  return `${url.pathname}${url.search}`;
}

function expiryMessage(domain: string, check: ExpiryCheck): string {
  switch (check.outcome) {
    case "found":
      return `${check.domain} kedaluwarsa ${formatDate(check.expiresAt)} (sumber: ${check.source === "RDAP" ? "registry domain (RDAP)" : "Hostinger"}).`;
    case "temporary":
      return `${domain} adalah alamat sementara Hostinger dan tidak punya tanggal kedaluwarsa.`;
    case "invalid":
      return `${domain || "(kosong)"} bukan nama domain yang bisa dicek.`;
    case "not_registered":
      return `${check.domain} tidak terdaftar di registry domain: kemungkinan sudah kedaluwarsa lalu dilepas, atau belum pernah didaftarkan.`;
    case "not_found":
      return `Tanggal kedaluwarsa ${domain} tidak ditemukan di Hostinger maupun di registry domain.`;
    case "error":
      return `Pengecekan ${domain} gagal (${check.reason}). Coba lagi beberapa saat lagi.`;
  }
}

export function webActions(deps: {
  db: PrismaClient;
  verify: (alias: string, requestId: string) => Promise<VerifyResult | null>;
  checkExpiry: (domain: string, requestId: string) => Promise<ExpiryCheck>;
}): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: Form }>("/aksi/cek-domain", async (request, reply) => {
      const domain = field(request.body, "domain").toLowerCase();
      const back = safeReturnPath(request.body?.kembali);
      const check = await deps.checkExpiry(domain, request.id);
      return reply.redirect(withMessage(back, expiryMessage(domain, check)), 303);
    });

    app.post<{ Body: Form }>("/aksi/cek-domain-semua", async (request, reply) => {
      const back = safeReturnPath(request.body?.kembali);
      const job = await enqueueJob(deps.db, { kind: "check-domain-expiry", payload: {}, dedupeKey: "check-domain-expiry" });
      await deps.db.auditLog.create({
        data: { requestId: request.id, actor: "WEB_HUMAN", action: "DOMAIN_EXPIRY_REQUEST", resource: "domain", result: job.created ? "queued" : "already_queued" },
      });
      const message = job.created
        ? "Pengecekan tanggal kedaluwarsa domain diantrekan. Satu domain per detik, jadi bisa makan beberapa menit; hasilnya muncul di daftar job di bawah."
        : "Pengecekan tanggal kedaluwarsa domain sudah dalam antrean.";
      return reply.redirect(withMessage(back, message), 303);
    });

    app.post<{ Body: Form }>("/aksi/kecualikan", async (request, reply) => {
      const domain = field(request.body, "domain").toLowerCase();
      const mode = field(request.body, "mode");
      const back = safeReturnPath(request.body?.kembali);
      if (mode !== "kecualikan" && mode !== "tampilkan") return reply.redirect(withMessage(back, "Aksi tidak dikenal."), 303);
      const count = await setWebsiteExcluded(deps.db, { domain, excluded: mode === "kecualikan", actor: "WEB_HUMAN", requestId: request.id });
      const message =
        count === 0
          ? `Website ${domain || "(kosong)"} tidak ditemukan.`
          : mode === "kecualikan"
            ? `${domain} dikecualikan dari daftar dan pencarian. Halamannya tetap bisa dibuka lewat tautan "Lihat" di halaman Website.`
            : `${domain} tampil lagi di daftar.`;
      return reply.redirect(withMessage(back, message), 303);
    });

    app.post<{ Body: Form }>("/aksi/kenali-jenis", async (request, reply) => {
      const back = safeReturnPath(request.body?.kembali);
      const job = await enqueueJob(deps.db, { kind: "detect-website-types", payload: {}, dedupeKey: "detect-website-types" });
      await deps.db.auditLog.create({
        data: { requestId: request.id, actor: "WEB_HUMAN", action: "WEBSITE_TYPE_REQUEST", resource: "website", result: job.created ? "queued" : "already_queued" },
      });
      const message = job.created
        ? "Pengenalan jenis website diantrekan. Folder web tiap website yang belum dikenali dibaca lewat API Hostinger; hasilnya muncul di daftar job di bawah."
        : "Pengenalan jenis website sudah dalam antrean.";
      return reply.redirect(withMessage(back, message), 303);
    });

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
