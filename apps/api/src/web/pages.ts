import type { Prisma, PrismaClient } from "@ops/database";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { capacityReport, inventoryTotals, listPlans, type PlanRow, type PlanSort } from "../services/inventory-report.js";
import { accessibleBy, loginSummaries } from "../services/summaries.js";
import { daysUntil, formatCount, formatDate, formatDateTime, formatRelativeDays } from "./format.js";
import { html, type SafeHtml } from "./html.js";
import { layout, type Section } from "./layout.js";

const PAGE_SIZE = 50;
const URGENT_DAYS = 7;
const WEBSITE_TYPES = ["WORDPRESS", "LARAVEL", "CUSTOM_PHP", "STATIC", "UNKNOWN"] as const;
const WEBSITE_STATUSES = ["ACTIVE", "SUSPENDED", "UNKNOWN"] as const;
const TYPE_LABELS: Record<string, string> = {
  WORDPRESS: "WordPress",
  LARAVEL: "Laravel",
  CUSTOM_PHP: "PHP lain",
  STATIC: "Statis",
  UNKNOWN: "Belum dikenali",
};
const ACTOR_LABELS: Record<string, string> = { CLAUDE_MCP: "Claude", CLI_HUMAN: "Terminal", WORKER: "Worker", WEB_HUMAN: "Web" };

type Query = Record<string, string | undefined>;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function send(reply: FastifyReply, body: string, code = 200) {
  return reply.code(code).type("text/html; charset=utf-8").send(body);
}

function render(reply: FastifyReply, opts: { title: string; active?: Section; query?: Query; body: SafeHtml }, code = 200) {
  return send(reply, layout({ title: opts.title, active: opts.active, message: text(opts.query?.pesan), body: opts.body }), code);
}

function expiryCell(date: Date | null) {
  if (!date) return html`<td class="muted">tidak diketahui</td>`;
  const urgent = daysUntil(date) <= URGENT_DAYS;
  return html`<td><span${urgent ? html` class="urgent"` : ""}>${formatRelativeDays(date)}</span><br><span class="muted">${formatDate(date)}</span></td>`;
}

const autoRenewText = (value: boolean | null) => (value === null ? "tidak diketahui" : value ? "aktif" : "mati");

function loginOptions(aliases: string[], selected: string) {
  return [
    html`<option value="">Semua login</option>`,
    aliases.map((alias) => html`<option value="${alias}"${alias === selected ? html` selected` : ""}>${alias}</option>`),
  ];
}

function table(head: SafeHtml, rows: SafeHtml[], caption: string) {
  return html`<div class="table-wrap"><table aria-label="${caption}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function planCodeCell(plan: { code: string; username: string | null }) {
  return html`<td><span class="code">${plan.code}</span>${plan.username ? html`<br><span class="code muted">${plan.username}</span>` : ""}</td>`;
}

async function ringkasan(db: PrismaClient) {
  const [totals, report, logins] = await Promise.all([inventoryTotals(db), capacityReport(db), loginSummaries(db)]);
  const stat = (key: keyof typeof totals, label: string) =>
    html`<div><dt>${label}</dt><dd data-stat="${key}">${totals[key]}</dd></div>`;
  const expiring = report.expiringSoon.map(
    (plan) =>
      html`<tr>${planCodeCell(plan)}<td>${plan.planType ?? "tidak diketahui"}</td><td>${plan.loginAlias}</td>${expiryCell(
        plan.expiresAt ? new Date(plan.expiresAt) : null,
      )}<td${plan.autoRenew === false ? html` class="urgent"` : ""}>${autoRenewText(plan.autoRenew)}</td><td class="num">${plan.websiteCount ?? 0}</td></tr>`,
  );
  const loginRows = logins.map(
    (login) =>
      html`<tr><th scope="row">${login.alias}</th><td${login.status === "CONNECTED" ? "" : html` class="urgent"`}>${login.status}</td><td>${formatDateTime(
        login.lastVerifiedAt ? new Date(login.lastVerifiedAt) : null,
      )}</td><td>${formatDateTime(login.lastSyncedAt ? new Date(login.lastSyncedAt) : null)}</td><td>${
        login.sync
          ? html`<span${login.sync.status === "FAILED" ? html` class="urgent"` : ""}>${login.sync.status}</span>${
              login.sync.error ? html`<br><span class="muted">${login.sync.error}</span>` : ""
            }`
          : html`<span class="muted">belum ada</span>`
      }</td></tr>`,
  );
  return html`
<dl class="stats" aria-label="Jumlah saat ini">
${stat("logins", "Login")}${stat("accounts", "Paket")}${stat("websites", "Website")}${stat("wordpress", "WordPress")}
</dl>
<p class="lead">Paket dan website yang tidak lagi terlihat di Hostinger (UNKNOWN) tidak dihitung.</p>
<h2>Paket yang habis dalam 30 hari</h2>
<p class="lead">Termasuk paket yang tanggalnya sudah lewat. Paket tanpa data tagihan tidak muncul di sini.</p>
${
  expiring.length
    ? table(
        html`<th scope="col">Kode order / username</th><th scope="col">Paket</th><th scope="col">Pemilik</th><th scope="col">Habis</th><th scope="col">Auto-renew</th><th scope="col" class="num">Website</th>`,
        expiring,
        "Paket yang habis dalam 30 hari",
      )
    : html`<p class="empty">Tidak ada paket yang habis dalam 30 hari ke depan.</p>`
}
<h2>Login Hostinger</h2>
${
  loginRows.length
    ? table(
        html`<th scope="col">Login</th><th scope="col">Koneksi</th><th scope="col">Diuji</th><th scope="col">Sinkron terakhir</th><th scope="col">Job terakhir</th>`,
        loginRows,
        "Login Hostinger",
      )
    : html`<p class="empty">Belum ada login. Tambahkan dari terminal Anda sendiri: <span class="code">corepack pnpm ops:login:add &lt;alias&gt;</span></p>`
}`;
}

function planRow(plan: PlanRow) {
  return html`<tr data-row="plan">${planCodeCell(plan)}<td>${plan.planType ?? "tidak diketahui"}</td><td>${plan.status ?? "tidak diketahui"}</td><td class="num">${plan.websites}</td>${expiryCell(
    plan.expiresAt ? new Date(plan.expiresAt) : null,
  )}<td>${autoRenewText(plan.autoRenew)}</td><td>${plan.loginAlias}</td><td>${plan.sharedWith.length ? plan.sharedWith.join(", ") : html`<span class="muted">tidak ada</span>`}</td></tr>`;
}

async function paket(db: PrismaClient, query: Query) {
  const login = text(query.login);
  const sort: PlanSort = query.urut === "website" || query.urut === "kode" ? query.urut : "habis";
  const aliases = (await db.hostingerLogin.findMany({ orderBy: { alias: "asc" }, select: { alias: true } })).map((l) => l.alias);
  const unknownLogin = login !== "" && !aliases.includes(login);
  const { plans, unknownCount } = unknownLogin ? { plans: [], unknownCount: 0 } : await listPlans(db, { login: login || undefined, sort });
  const sortOption = (value: PlanSort, label: string) =>
    html`<option value="${value}"${value === sort ? html` selected` : ""}>${label}</option>`;
  return html`
<form class="filters" method="get" action="/paket">
<label>Login<select name="login">${loginOptions(aliases, login)}</select></label>
<label>Urutkan<select name="urut">${sortOption("habis", "Tanggal habis terdekat")}${sortOption("website", "Website paling sedikit")}${sortOption("kode", "Kode order")}</select></label>
<button type="submit">Tampilkan</button>
</form>
${unknownLogin ? html`<p class="empty">Login ${login} tidak ditemukan.</p>` : ""}
${
  plans.length
    ? table(
        html`<th scope="col">Kode order / username</th><th scope="col">Paket</th><th scope="col">Status</th><th scope="col" class="num">Website</th><th scope="col">Habis</th><th scope="col">Auto-renew</th><th scope="col">Pemilik</th><th scope="col">Dibagi ke</th>`,
        plans.map(planRow),
        "Paket hosting",
      )
    : unknownLogin
      ? ""
      : html`<p class="empty">Belum ada paket. Jalankan sinkronisasi dari Claude atau halaman Ringkasan.</p>`
}
${unknownCount ? html`<p class="lead">${unknownCount} paket tidak lagi terlihat di Hostinger (UNKNOWN) dan tidak ditampilkan.</p>` : ""}`;
}

function pageNumber(value: unknown) {
  const raw = text(value);
  return /^\d+$/.test(raw) && Number(raw) >= 1 ? Number(raw) : 1;
}

async function website(db: PrismaClient, query: Query) {
  const q = text(query.q);
  const login = text(query.login);
  const jenis = WEBSITE_TYPES.find((t) => t === query.jenis);
  const status = WEBSITE_STATUSES.find((s) => s === query.status);
  const hal = pageNumber(query.hal);
  const aliases = (await db.hostingerLogin.findMany({ orderBy: { alias: "asc" }, select: { alias: true } })).map((l) => l.alias);
  const where: Prisma.WebsiteWhereInput = {
    // Prisma passes `contains` to ILIKE unescaped, so % and _ would act as wildcards.
    ...(q ? { domain: { contains: q.replace(/[\\%_]/g, (c) => `\\${c}`), mode: "insensitive" } } : {}),
    status: status ?? { not: "UNKNOWN" },
    ...(jenis ? { websiteType: jenis } : {}),
    ...(login ? { account: accessibleBy(login) } : {}),
  };
  const [total, rows] = await Promise.all([
    db.website.count({ where }),
    db.website.findMany({
      where,
      include: { account: { select: { username: true, login: { select: { alias: true } } } } },
      orderBy: { domain: "asc" },
      skip: (hal - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const linkTo = (page: number) =>
    `/website?${new URLSearchParams({ q, login, jenis: jenis ?? "", status: status ?? "", hal: String(page) })}`;
  const option = (value: string, label: string, selected: string | undefined) =>
    html`<option value="${value}"${value === (selected ?? "") ? html` selected` : ""}>${label}</option>`;
  const body = rows.map(
    (w) =>
      html`<tr data-row="website"><th scope="row"><a href="/website/${encodeURIComponent(w.domain)}">${w.domain}</a></th><td>${TYPE_LABELS[w.websiteType] ?? w.websiteType}</td><td${w.status === "ACTIVE" ? "" : html` class="urgent"`}>${w.status}</td><td><span class="code">${w.account.username ?? ""}</span></td><td>${w.account.login.alias}</td><td><span class="path">${w.webRoot ?? ""}</span></td></tr>`,
  );
  const results =
    total === 0
      ? html`<p class="empty">Tidak ada website yang cocok dengan pencarian ini.</p>`
      : rows.length === 0
        ? html`<p class="empty">Tidak ada website di halaman ini. <a href="${linkTo(1)}">Kembali ke halaman 1</a></p>`
        : html`<p class="lead">${formatCount(total)} website, halaman ${hal} dari ${lastPage}.</p>
${table(
  html`<th scope="col">Domain</th><th scope="col">Jenis</th><th scope="col">Status</th><th scope="col">Username</th><th scope="col">Login pemilik</th><th scope="col">Folder web</th>`,
  body,
  "Website",
)}
<nav class="pager" aria-label="Halaman">${hal > 1 ? html`<a href="${linkTo(hal - 1)}">Halaman sebelumnya</a>` : ""}${
            hal < lastPage ? html`<a href="${linkTo(hal + 1)}">Halaman berikutnya</a>` : ""
          }</nav>`;
  return html`
<form class="filters" method="get" action="/website">
<label>Cari domain<input type="search" name="q" value="${q}" placeholder="sebagian nama domain"></label>
<label>Login<select name="login">${loginOptions(aliases, login)}</select></label>
<label>Jenis<select name="jenis">${option("", "Semua jenis", jenis)}${WEBSITE_TYPES.map((t) => option(t, TYPE_LABELS[t]!, jenis))}</select></label>
<label>Status<select name="status">${option("", "Semua kecuali UNKNOWN", status)}${WEBSITE_STATUSES.map((s) => option(s, s, status))}</select></label>
<button type="submit">Cari</button>
</form>
${results}`;
}

async function websiteDetail(db: PrismaClient, domain: string) {
  const rows = await db.website.findMany({
    where: { domain: { equals: domain, mode: "insensitive" } },
    include: {
      account: { include: { login: { select: { alias: true } }, access: { select: { login: { select: { alias: true } } } } } },
      project: { select: { code: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return null;
  return rows.map((w) => {
    const provider = ((w.metadata as { provider?: Record<string, unknown> } | null)?.provider ?? {}) as Record<string, unknown>;
    const field = (label: string, value: unknown, className = "") =>
      html`<dt>${label}</dt><dd${className ? html` class="${className}"` : ""}>${value === null || value === undefined || value === "" ? "tidak diketahui" : String(value)}</dd>`;
    return html`<h2>${w.domain}</h2><dl class="detail">
${field("Status", w.status)}${field("Jenis", TYPE_LABELS[w.websiteType] ?? w.websiteType)}${field("Jenis di Hostinger", provider.websiteType)}
${field("Kode order", w.account.code, "code")}${field("Paket", w.account.planType)}${field("Username", w.account.username, "code")}
${field("Login pemilik", w.account.login.alias)}${field("Bisa diakses dari", w.account.access.map((a) => a.login.alias).join(", "))}
${field("Folder web", w.webRoot, "path")}${field("Jenis vhost", provider.vhostType)}${field("Domain induk", provider.parentDomain)}
${field("Proyek", w.project ? `${w.project.code} (${w.project.name})` : "belum dipetakan")}
${field("Dicatat sejak", formatDateTime(w.createdAt))}${field("Diperbarui", formatDateTime(w.updatedAt))}
</dl>`;
  });
}

function jobSummary(result: unknown, error: string | null) {
  if (error) return html`<span class="muted">${error}</span>`;
  const r = result as { accounts?: number; websites?: number } | null;
  return r && typeof r.accounts === "number" ? `${r.accounts} paket, ${r.websites ?? 0} website` : "";
}

async function sinkron(db: PrismaClient, query: Query) {
  const showApi = query.api === "1";
  const login = text(query.login);
  const logins = await db.hostingerLogin.findMany({ orderBy: { alias: "asc" }, select: { id: true, alias: true } });
  const aliasById = new Map(logins.map((l) => [l.id, l.alias]));
  const selected = logins.find((l) => l.alias === login);
  const [summaries, jobs, audit] = await Promise.all([
    loginSummaries(db, selected ? { id: selected.id } : {}),
    db.job.findMany({
      where: selected ? { payload: { path: ["loginId"], equals: selected.id } } : {},
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.auditLog.findMany({
      where: { ...(showApi ? {} : { action: { not: "HOSTINGER_API_CALL" } }), ...(selected ? { resourceId: selected.alias } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const jobLogin = (payload: unknown) => aliasById.get(String((payload as { loginId?: unknown } | null)?.loginId)) ?? "tidak diketahui";
  const statusRows = summaries.map(
    (s) =>
      html`<tr><th scope="row">${s.alias}</th><td>${formatDateTime(s.lastSyncedAt ? new Date(s.lastSyncedAt) : null)}</td><td${
        s.sync?.status === "FAILED" ? html` class="urgent"` : ""
      }>${s.sync?.status ?? "belum ada"}</td><td>${s.sync?.error ? html`<span class="muted">${s.sync.error}</span>` : ""}</td></tr>`,
  );
  const jobRows = jobs.map(
    (j) =>
      html`<tr><td>${j.kind}</td><td>${jobLogin(j.payload)}</td><td${j.status === "FAILED" ? html` class="urgent"` : ""}>${j.status}</td><td class="num">${j.attempts}</td><td>${formatDateTime(j.startedAt, "belum mulai")}</td><td>${formatDateTime(
        j.finishedAt,
        "belum selesai",
      )}</td><td>${jobSummary(j.result, j.error)}</td></tr>`,
  );
  const auditRows = audit.map(
    (a) =>
      html`<tr><td>${formatDateTime(a.createdAt)}</td><td>${ACTOR_LABELS[a.actor] ?? a.actor}</td><td><span class="code">${a.action}</span></td><td>${a.resource}${a.resourceId ? html`: ${a.resourceId}` : ""}</td><td>${a.result}</td></tr>`,
  );
  const apiToggle = new URLSearchParams({ ...(login ? { login } : {}), ...(showApi ? {} : { api: "1" }) });
  return html`
<form class="filters" method="get" action="/sinkron">
<label>Login<select name="login">${loginOptions(logins.map((l) => l.alias), login)}</select></label>
${showApi ? html`<input type="hidden" name="api" value="1">` : ""}
<button type="submit">Tampilkan</button>
</form>
<h2>Status per login</h2>
${
  statusRows.length
    ? table(html`<th scope="col">Login</th><th scope="col">Sinkron terakhir</th><th scope="col">Job terakhir</th><th scope="col">Error</th>`, statusRows, "Status sinkron")
    : html`<p class="empty">Belum ada login.</p>`
}
<h2>30 job terakhir</h2>
${
  jobRows.length
    ? table(
        html`<th scope="col">Jenis</th><th scope="col">Login</th><th scope="col">Status</th><th scope="col" class="num">Percobaan</th><th scope="col">Mulai</th><th scope="col">Selesai</th><th scope="col">Hasil</th>`,
        jobRows,
        "Job",
      )
    : html`<p class="empty">Belum ada job. Sinkronisasi pertama akan muncul di sini.</p>`
}
<h2>50 catatan audit terakhir</h2>
<p class="lead">${showApi ? "Termasuk setiap panggilan ke Hostinger." : "Panggilan per request ke Hostinger disembunyikan."} <a href="/sinkron?${apiToggle}">${
    showApi ? "Sembunyikan panggilan API Hostinger" : "Tampilkan panggilan API Hostinger"
  }</a></p>
${
  auditRows.length
    ? table(html`<th scope="col">Waktu</th><th scope="col">Pelaku</th><th scope="col">Aksi</th><th scope="col">Sumber</th><th scope="col">Hasil</th>`, auditRows, "Audit")
    : html`<p class="empty">Belum ada catatan audit.</p>`
}`;
}

export function webPages(db: PrismaClient): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: Query }>("/ringkasan", async (request, reply) =>
      render(reply, { title: "Ringkasan", active: "ringkasan", query: request.query, body: await ringkasan(db) }),
    );
    app.get<{ Querystring: Query }>("/paket", async (request, reply) =>
      render(reply, { title: "Paket", active: "paket", query: request.query, body: await paket(db, request.query) }),
    );
    app.get<{ Querystring: Query }>("/website", async (request, reply) =>
      render(reply, { title: "Website", active: "website", query: request.query, body: await website(db, request.query) }),
    );
    app.get<{ Params: { domain: string }; Querystring: Query }>("/website/:domain", async (request, reply) => {
      const details = await websiteDetail(db, request.params.domain);
      if (!details) {
        return render(
          reply,
          { title: "Website tidak ditemukan", active: "website", body: html`<p class="empty">Website tidak ditemukan di inventaris. <a href="/website">Kembali ke pencarian</a></p>` },
          404,
        );
      }
      return render(reply, { title: "Detail website", active: "website", query: request.query, body: html`${details}` });
    });
    app.get<{ Querystring: Query }>("/sinkron", async (request, reply) =>
      render(reply, { title: "Sinkron & Audit", active: "sinkron", query: request.query, body: await sinkron(db, request.query) }),
    );
  };
}

export function errorPage(): string {
  return layout({
    title: "Terjadi kesalahan",
    body: html`<p class="empty">Halaman ini gagal dimuat. Muat ulang halaman; bila tetap gagal, detailnya ada di log API (jendela <span class="code">corepack pnpm dev:api</span>).</p>`,
  });
}

export function notFoundPage(): string {
  return layout({ title: "Halaman tidak ada", body: html`<p class="empty">Alamat ini tidak ada. <a href="/ringkasan">Ke Ringkasan</a></p>` });
}
