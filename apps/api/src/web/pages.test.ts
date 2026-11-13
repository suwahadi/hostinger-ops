import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test } from "vitest";
import { buildApp } from "../app.js";
import { inventoryTotals } from "../services/inventory-report.js";
import { setUiPassword } from "../services/ui-password.js";

const apiKey = "k".repeat(40);
const password = "kata sandi panjang 1";
const host = "127.0.0.1:3000";
const db = await createTestDb();
const app = buildApp({ db, apiKey, masterKey: parseMasterKey("ab".repeat(32)), limiter: { acquire: async () => {} } });
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const day = 24 * 60 * 60 * 1000;
const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER", status: "CONNECTED" } });
const tujuan = await db.hostingerLogin.create({ data: { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN", status: "TOKEN_INVALID" } });
const shared = await db.hostingAccount.create({
  data: {
    code: "1001",
    loginId: sumber.id,
    status: "active",
    planType: "hostinger_premium_v2",
    username: "u111",
    expiresAt: new Date(Date.now() + 3 * day + 60_000),
    autoRenew: false,
    ownerSource: "BILLING",
  },
});
const large = await db.hostingAccount.create({
  data: { code: "1002", loginId: tujuan.id, status: "active", planType: "hostinger_business_v3", username: "u222", expiresAt: new Date(Date.now() + 90 * day) },
});
await db.hostingAccount.create({ data: { code: "1003", loginId: sumber.id, status: "UNKNOWN" } });
await db.hostingAccountAccess.createMany({
  data: [
    { loginId: sumber.id, accountId: shared.id },
    { loginId: tujuan.id, accountId: shared.id },
    { loginId: tujuan.id, accountId: large.id },
  ],
});
await db.website.createMany({
  data: [
    {
      accountId: shared.id,
      domain: "contoh.com",
      websiteType: "WORDPRESS",
      webRoot: "/home/u111/domains/contoh.com/public_html",
      metadata: { provider: { websiteType: "wordpress", vhostType: "main" } },
    },
    { accountId: shared.id, domain: "x<script>alert(1)</script>.com", websiteType: "WORDPRESS" },
    { accountId: shared.id, domain: "under_score.com" },
    { accountId: large.id, domain: "hilang.com", status: "UNKNOWN" },
    ...Array.from({ length: 55 }, (_, i) => ({ accountId: large.id, domain: `situs-${String(i + 1).padStart(2, "0")}.com` })),
  ],
});
await db.job.create({
  data: {
    kind: "sync-login",
    payload: { loginId: tujuan.id },
    dedupeKey: `sync-login:${tujuan.id}`,
    status: "FAILED",
    attempts: 3,
    error: "Hostinger GET /api/hosting/v1/websites failed: 500",
    finishedAt: new Date(),
  },
});
await db.auditLog.createMany({
  data: [
    { requestId: "a1", actor: "WORKER", action: "HOSTINGER_API_CALL", resource: "hostinger_login", resourceId: "sumber", result: "200" },
    { requestId: "a2", actor: "WEB_HUMAN", action: "SYNC_REQUEST", resource: "hostinger_login", resourceId: "sumber", result: "queued" },
  ],
});

await setUiPassword(db, password);
const loginRes = await app.inject({
  method: "POST",
  url: "/login",
  headers: { host, origin: `http://${host}`, "content-type": "application/x-www-form-urlencoded" },
  payload: new URLSearchParams({ password }).toString(),
});
const cookie = String(loginRes.headers["set-cookie"]).split(";")[0]!;
const page = (url: string) => app.inject({ url, headers: { host, cookie } });
const rowCount = (body: string, kind: string) => body.split(`data-row="${kind}"`).length - 1;
const rowOf = (body: string, text: string) => body.split("<tr").find((row) => row.includes(text)) ?? "";

test("ringkasan shows totals equal to /v1/capacity and the expiring plans", async () => {
  const totals = await inventoryTotals(db);
  const capacity = (await app.inject({ url: "/v1/capacity", headers: { "x-api-key": apiKey } })).json().totals;
  expect(capacity).toEqual({ accounts: totals.accounts, websites: totals.websites });
  const res = await page("/ringkasan");
  expect(res.statusCode).toBe(200);
  for (const [key, value] of Object.entries(totals)) expect(res.body).toContain(`data-stat="${key}">${value}<`);
  expect(rowOf(res.body, "1001")).toContain("3 hari lagi");
  expect(res.body).not.toContain(">1002<");
  expect(rowOf(res.body, ">tujuan<")).toContain("TOKEN_INVALID");
});

test("paket lists shared plans with 'dibagi ke' and hides UNKNOWN plans, mentioning how many", async () => {
  const res = await page("/paket");
  expect(res.body).toContain("Dibagi ke");
  expect(rowOf(res.body, "1001")).toContain("tujuan");
  expect(res.body).toContain("1002");
  expect(res.body).not.toContain(">1003<");
  expect(res.body).toContain("1 paket tidak lagi terlihat di Hostinger");
});

test("paket filtered by an unknown login shows an empty table with a message", async () => {
  const res = await page("/paket?login=tidak-ada");
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("Login tidak-ada tidak ditemukan");
  expect(rowCount(res.body, "plan")).toBe(0);
});

test("website search finds by part of a domain, case-insensitive, 50 per page", async () => {
  const first = await page("/website?q=SITUS");
  expect(rowCount(first.body, "website")).toBe(50);
  expect(first.body).toContain("hal=2");
  const second = await page("/website?q=SITUS&hal=2");
  expect(rowCount(second.body, "website")).toBe(5);
});

test("website search treats % and _ literally", async () => {
  const percent = await page("/website?q=%25");
  expect(rowCount(percent.body, "website")).toBe(0);
  expect(percent.body).toContain("Tidak ada website yang cocok");
  const underscore = await page("/website?q=_");
  expect(rowCount(underscore.body, "website")).toBe(1);
  expect(underscore.body).toContain("under_score.com");
});

test("website page numbers that are not positive integers fall back to page 1; past the end shows an empty message", async () => {
  for (const hal of ["abc", "0", "-3", "1.5"]) {
    expect(rowCount((await page(`/website?q=situs&hal=${hal}`)).body, "website")).toBe(50);
  }
  const past = await page("/website?q=situs&hal=999");
  expect(rowCount(past.body, "website")).toBe(0);
  expect(past.body).toContain("Tidak ada website di halaman ini");
});

test("website hides UNKNOWN websites unless status=UNKNOWN is chosen", async () => {
  expect(rowCount((await page("/website?q=hilang")).body, "website")).toBe(0);
  expect(rowCount((await page("/website?q=hilang&status=UNKNOWN")).body, "website")).toBe(1);
});

test("website detail shows plan, owner login and provider metadata; unknown domain is 404", async () => {
  const res = await page("/website/contoh.com");
  expect(res.statusCode).toBe(200);
  expect(res.body).toContain("1001");
  expect(res.body).toContain("sumber");
  expect(res.body).toContain("/home/u111/domains/contoh.com/public_html");
  expect(res.body).toContain("main");
  const missing = await page("/website/tidak-ada.com");
  expect(missing.statusCode).toBe(404);
  expect(missing.body).toContain("Website tidak ditemukan");
});

test("a domain containing <script> is shown as text on every page", async () => {
  for (const url of ["/website?q=script", "/paket", "/ringkasan"]) {
    const res = await page(url);
    expect(res.body).not.toContain("<script>alert");
  }
  expect((await page("/website?q=script")).body).toContain("x&lt;script&gt;alert(1)&lt;/script&gt;.com");
});

test("sinkron shows a FAILED job with its error and hides HOSTINGER_API_CALL unless api=1", async () => {
  const res = await page("/sinkron");
  expect(rowOf(res.body, "FAILED")).toContain("Hostinger GET /api/hosting/v1/websites failed: 500");
  expect(rowOf(res.body, "FAILED")).toContain("tujuan");
  expect(res.body).toContain("SYNC_REQUEST");
  expect(res.body).not.toContain("HOSTINGER_API_CALL");
  expect((await page("/sinkron?api=1")).body).toContain("HOSTINGER_API_CALL");
});

test("messages passed after an action are escaped", async () => {
  const res = await page("/ringkasan?pesan=%3Cb%3Ehalo%3C%2Fb%3E");
  expect(res.body).toContain("&lt;b&gt;halo&lt;/b&gt;");
});

test("app.css is served as text/css without a session", async () => {
  const res = await app.inject({ url: "/assets/app.css", headers: { host } });
  expect(res.statusCode).toBe(200);
  expect(res.headers["content-type"]).toContain("text/css");
});

test("ringkasan counts websites per expiring plan from website rows, like the totals", async () => {
  expect(rowOf((await page("/ringkasan")).body, "1001")).toContain('class="num">3<');
});

test("favicon.ico answers 204 without a session so browsers log no error", async () => {
  const res = await app.inject({ url: "/favicon.ico", headers: { host } });
  expect(res.statusCode).toBe(204);
});

test("paket links each username to the website page for that plan", async () => {
  expect((await page("/paket")).body).toContain('href="/website?username=u111"');
});

test("website filtered by username shows the plan details and only its websites", async () => {
  const res = await page("/website?username=U111");
  expect(res.body).toContain('data-plan="1001"');
  expect(res.body).toContain("hostinger_premium_v2");
  expect(rowCount(res.body, "website")).toBe(3);
  expect(res.body).not.toContain("situs-01.com");
  expect(res.body).toContain('name="username" value="u111"');
});

test("a username with no plan says so", async () => {
  const res = await page("/website?username=u999");
  expect(res.body).toContain("Tidak ada paket dengan username u999");
  expect(rowCount(res.body, "website")).toBe(0);
});

test("paket search finds plans by part of the username or order code", async () => {
  expect(rowCount((await page("/paket?cari=222")).body, "plan")).toBe(1);
  expect(rowOf((await page("/paket?cari=U11")).body, 'data-row="plan"')).toContain("1001");
  expect(rowCount((await page("/paket?cari=1002")).body, "plan")).toBe(1);
  expect(rowCount((await page("/paket?cari=%25")).body, "plan")).toBe(0);
});

test("website pagination shows numbered pages with previous and next", async () => {
  const body = (await page("/website?q=situs&hal=2")).body;
  expect(body).toContain('aria-current="page"');
  expect(body).toMatch(/href="[^"]*hal=1"[^>]*>1</);
  expect(body).toContain('aria-label="Halaman sebelumnya"');
  expect(body).toContain('aria-label="Halaman berikutnya"');
});

test("website detail links the domain in a new tab, only for a real hostname", async () => {
  const body = (await page("/website/contoh.com")).body;
  expect(body).toContain('href="https://contoh.com"');
  expect(body).toContain('target="_blank"');
  expect(body).toContain('rel="noopener noreferrer"');
  const odd = (await page(`/website/${encodeURIComponent("x<script>alert(1)</script>.com")}`)).body;
  expect(odd).not.toContain('target="_blank"');
});

test("pages load the busy script and action forms opt in to the loader", async () => {
  const body = (await page("/ringkasan")).body;
  expect(body).toContain('<script src="/assets/app.js" defer></script>');
  expect(body).toContain('class="busy"');
  expect(body).toMatch(/<form[^>]*action="\/aksi\/sinkron"[^>]*data-busy="[^"]+"/);
  const script = await app.inject({ url: "/assets/app.js", headers: { host } });
  expect(script.statusCode).toBe(200);
  expect(String(script.headers["content-type"])).toContain("javascript");
});

test("the sidebar shows an icon next to every menu item", async () => {
  const body = (await page("/paket")).body;
  const nav = body.slice(body.indexOf('<nav class="side"'), body.indexOf("</nav>"));
  expect(nav.split('<svg class="icon"').length - 1).toBe(5);
  expect(nav).toContain('aria-hidden="true"');
});

test("the login page is titled Login Panel", async () => {
  const res = await app.inject({ url: "/login", headers: { host } });
  expect(res.body).toContain("<h1>Login Panel</h1>");
});

test("the external link is offered only for a plain hostname, never one that points elsewhere", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1002" } });
  for (const domain of ["x@evil.com", "a/b.com", "a:b.com"]) {
    await db.website.create({ data: { accountId: account.id, domain } });
    expect((await page(`/website/${encodeURIComponent(domain)}`)).body).not.toContain('target="_blank"');
    expect((await page(`/website?q=${encodeURIComponent(domain)}`)).body).not.toContain('target="_blank"');
  }
});

test("the login page shows only Login Panel, without the product name", async () => {
  const body = (await app.inject({ url: "/login", headers: { host } })).body;
  expect(body).toContain("<title>Login Panel</title>");
  expect(body).not.toContain("Hostinger Ops");
});

test("website detail ends with the domain expiry, using the parent domain for subdomains", async () => {
  await db.domain.create({ data: { name: "contoh.com", status: "active", expiresAt: new Date("2027-03-12T00:00:00Z") } });
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1001" } });
  await db.website.create({ data: { accountId: account.id, domain: "blog.contoh.com" } });
  for (const url of ["/website/contoh.com", "/website/blog.contoh.com"]) {
    const body = (await page(url)).body;
    const tail = body.slice(body.lastIndexOf("<dt>"));
    expect(tail).toContain("Domain expired");
    expect(tail).toContain("12 Mar 2027");
  }
  expect((await page("/website/under_score.com")).body).toContain("Domain expired</dt><dd>tidak diketahui");
});

test("website type is shown as a coloured logo only, named for screen readers; unrecognised types get the Chrome mark", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1001" } });
  await db.website.createMany({
    data: [
      { accountId: account.id, domain: "jenis-laravel.com", websiteType: "LARAVEL" },
      { accountId: account.id, domain: "jenis-php.com", websiteType: "CUSTOM_PHP" },
      { accountId: account.id, domain: "jenis-statis.com", websiteType: "STATIC" },
      { accountId: account.id, domain: "jenis-node.com", metadata: { provider: { websiteType: "nodejs" } } },
      { accountId: account.id, domain: "jenis-lain.com", metadata: { provider: { websiteType: "other" } } },
    ],
  });
  const cell = (body: string, domain: string) => body.slice(body.indexOf(`>${domain}</a>`)).split("</td>")[0]!;
  const list = (await page("/website?q=jenis-")).body;
  for (const [domain, name] of [["jenis-laravel.com", "Laravel"], ["jenis-php.com", "PHP"], ["jenis-statis.com", "HTML statis"], ["jenis-node.com", "Node.js"]]) {
    expect(cell(list, domain!)).toContain(`<svg class="type-logo" viewBox=`);
    expect(cell(list, domain!)).toContain(`role="img" aria-label="${name}"`);
  }
  expect(cell(list, "jenis-lain.com")).toContain(`<svg class="type-logo" viewBox="0 0 63 63"`);
  expect(cell(list, "jenis-lain.com")).toContain(`role="img" aria-label="Belum dikenali"`);
  const detail = (await page("/website/contoh.com")).body;
  expect(detail).toMatch(/<dt>Jenis<\/dt><dd><svg class="type-logo"[^>]*aria-label="WordPress"/);
});

test("type logos carry only plain shapes: no script, event handler, link or inline style", async () => {
  const list = (await page("/website?q=contoh")).body;
  const logos = list.match(/<svg class="type-logo"[\s\S]*?<\/svg>/g) ?? [];
  expect(logos.length).toBeGreaterThan(0);
  for (const logo of logos) {
    expect(logo).not.toMatch(/<script|\son[a-z]+=|href|style=|url\(|<image|<foreignObject/i);
    expect([...logo.matchAll(/<([a-z]+)/g)].every(([, tag]) => ["svg", "title", "g", "path", "rect"].includes(tag!))).toBe(true);
  }
});

test("website detail ends with a Kembali button under the box that goes back, or to /website when opened directly", async () => {
  const body = (await page("/website/contoh.com")).body;
  const after = body.slice(body.lastIndexOf("</dl>"));
  expect(after).toMatch(/<a class="back-link" href="\/website" data-back><svg class="icon"[\s\S]*?<span>Kembali<\/span><\/a>/);
  const script = (await app.inject({ url: "/assets/app.js", headers: { host } })).body;
  expect(script).toContain("a[data-back]");
  expect(script).toContain("history.back()");
  expect(script).toContain("document.referrer");
});

test("the login form locks itself and shows the loader while the password is checked", async () => {
  const form = (await app.inject({ url: "/login", headers: { host } })).body;
  expect(form).toContain('<script src="/assets/app.js" defer></script>');
  expect(form).toMatch(/<form method="post" action="\/login" class="login-form" data-busy="Memproses…">/);
  expect(form).toMatch(/<div class="busy" role="status" aria-live="polite" hidden>[\s\S]*class="spinner"/);
  const css = (await app.inject({ url: "/assets/app.css", headers: { host } })).body;
  expect(css).toContain(".login-page .busy-note { display: none; }");
});

test("the website list links each plain domain to its site in a new tab, right after the name", async () => {
  const body = (await page("/website?q=contoh.com")).body;
  expect(body).toContain(
    '<a href="/website/contoh.com">contoh.com</a> <a class="external" href="https://contoh.com" target="_blank" rel="noopener noreferrer" aria-label="Buka contoh.com di tab baru"',
  );
});

test("website detail says where the expiry date came from, when it was checked, and offers a Cek button", async () => {
  await db.domain.update({ where: { name: "contoh.com" }, data: { expirySource: "RDAP", expiryCheckedAt: new Date("2026-11-13T03:00:00Z") } });
  const body = (await page("/website/contoh.com")).body;
  const tail = body.slice(body.lastIndexOf("<dt>Domain expired</dt>"));
  expect(tail).toContain("dari registry domain (RDAP), dicek 13 Nov 2026");
  expect(tail).toContain(
    '<form method="post" action="/aksi/cek-domain" class="inline-form expiry-check" data-busy="Mengecek tanggal kedaluwarsa contoh.com…"><input type="hidden" name="domain" value="contoh.com"><input type="hidden" name="kembali" value="/website/contoh.com">',
  );
});

test("a temporary Hostinger address says it has no expiry date and offers no Cek button", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1001" } });
  await db.website.create({ data: { accountId: account.id, domain: "coba.hostingersite.com" } });
  const body = (await page("/website/coba.hostingersite.com")).body;
  expect(body).toContain("<dt>Domain expired</dt><dd>alamat sementara Hostinger, tidak punya tanggal kedaluwarsa</dd>");
  expect(body).not.toContain('action="/aksi/cek-domain"');
});

test("Sinkron counts websites without an expiry date, offers one button to check them all, and summarises the bulk job", async () => {
  await db.job.create({
    data: { kind: "check-domain-expiry", payload: {}, status: "DONE", result: { pending: 12, checked: 10, found: 9, notFound: 1, errors: 0 } },
  });
  const body = (await page("/sinkron")).body;
  expect(body).toContain("<h2>Tanggal kedaluwarsa domain</h2>");
  expect(body).toMatch(/\d+ website belum punya tanggal kedaluwarsa domain\./);
  expect(body).toMatch(/<form method="post" action="\/aksi\/cek-domain-semua" class="toolbar" data-busy="[^"]+">/);
  expect(body).toContain("<td>check-domain-expiry</td><td>semua</td>");
  expect(body).toContain("10 domain dicek, 9 ditemukan");
});

test("Sinkron hides per-domain RDAP lookups in the audit list unless asked, like Hostinger API calls", async () => {
  await db.auditLog.create({ data: { requestId: "r-rdap", actor: "WORKER", action: "RDAP_LOOKUP", resource: "domain", resourceId: "rdap-contoh.com", result: "found" } });
  expect((await page("/sinkron")).body).not.toContain("rdap-contoh.com");
  expect((await page("/sinkron?api=1")).body).toContain("rdap-contoh.com");
});

test("a domain the registry says is not registered is flagged on the detail page and counted apart on Sinkron", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1001" } });
  await db.website.create({ data: { accountId: account.id, domain: "www.mati-contoh.com" } });
  await db.domain.create({ data: { name: "mati-contoh.com", expirySource: "RDAP", expiryCheckedAt: new Date("2026-11-13T03:00:00Z") } });
  const detail = (await page("/website/www.mati-contoh.com")).body;
  expect(detail).toContain('<dt>Domain expired</dt><dd class="urgent">tidak terdaftar di registry domain <span class="muted">· dicek 13 Nov 2026</span>');
  const sinkron = (await page("/sinkron")).body;
  expect(sinkron).toMatch(/\d+ website memakai domain yang tidak terdaftar di registry\./);
});

test("website detail says how the type was recognised from the files", async () => {
  const account = await db.hostingAccount.findUniqueOrThrow({ where: { code: "1001" } });
  await db.website.create({
    data: {
      accountId: account.id,
      domain: "dikenali-contoh.com",
      websiteType: "LARAVEL",
      metadata: { provider: { websiteType: "other" }, detection: { type: "LARAVEL", evidence: "index.php milik Laravel (LARAVEL_START)", checkedAt: "2026-11-13T04:00:00.000Z" } },
    },
  });
  const body = (await page("/website/dikenali-contoh.com")).body;
  expect(body).toMatch(/<dt>Jenis<\/dt><dd><svg class="type-logo"[^>]*aria-label="Laravel"[\s\S]*?<\/svg> <span class="muted">· dikenali dari index\.php milik Laravel \(LARAVEL_START\), 13 Nov 2026<\/span><\/dd>/);
});

test("Sinkron counts websites whose type is not recognised yet and summarises the detection job", async () => {
  await db.job.create({
    data: { kind: "detect-website-types", payload: {}, status: "DONE", result: { checked: 5, laravel: 3, wordpress: 0, php: 1, static: 1, unknown: 0, errors: 0 } },
  });
  const body = (await page("/sinkron")).body;
  expect(body).toContain("<h2>Jenis website</h2>");
  expect(body).toMatch(/\d+ website belum dikenali jenisnya\./);
  expect(body).toMatch(/<form method="post" action="\/aksi\/kenali-jenis" class="toolbar" data-busy="[^"]+">/);
  expect(body).toContain("<td>detect-website-types</td><td>semua</td>");
  expect(body).toContain("5 website dicek: 3 Laravel, 1 PHP lain, 1 statis");
});
