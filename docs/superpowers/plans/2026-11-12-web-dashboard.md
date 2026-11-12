# Tampilan Web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemilik bisa login di `http://127.0.0.1:3000/` dan melihat ringkasan, paket, website, serta status sinkronisasi dan audit, plus dua tombol yang hanya membaca dari Hostinger.

**Architecture:** Halaman HTML dirender server oleh Fastify yang sudah ada (`apps/api/src/web/`), tanpa JavaScript di halaman. Rute web memakai sesi cookie (di memori) dan dipisah tegas dari `/v1/*`, yang tetap memakai `x-api-key`. Password satu pengguna disimpan sebagai hash scrypt di tabel `ui_credentials`, dibuat lewat CLI.

**Tech Stack:** Sama dengan M3. Tidak ada dependensi baru.

**Spec:** `docs/superpowers/specs/2026-11-12-web-dashboard-design.md` (disetujui pemilik). Aturan repo: `AGENT.md`.

## Global Constraints

- **Dependensi dan JavaScript:** tidak ada dependensi npm baru, dan tidak ada JavaScript di halaman. Cookie dan form diurai manual (`URLSearchParams`).
- **Escape:** semua nilai dinamis di HTML melewati escape. Hanya fragmen hasil `html\`\`` yang boleh disisipkan tanpa escape.
- **Teks dan tampilan:** bahasa Indonesia, waktu dalam format `id-ID`. Aturan antislop (`antislop:antislop`, `antislop:antislop-ui`, `antislop:antislop-copywriting`, `antislop:antislop-human`) dimuat sebelum Task 5 dan diterapkan selama pengerjaan.
- **Batas akses:** cookie sesi tidak pernah membuka `/v1/*`; `x-api-key` tidak pernah membuka halaman web. Kunci API, token, dan isi vault tidak pernah dikirim ke browser.
- **Prisma:** hentikan API sebelum `prisma generate` (file engine Prisma terkunci; lihat `MEMORY.md`).
- **Commit:** hanya bila `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` lolos. Gunakan `if (…); then git commit; fi`, jangan merangkai commit setelah pemeriksaan yang mungkin gagal.
- **Komentar dan pesan commit:** mengikuti AGENT.md §1 dan §4.

## Review Focus

1. API dinyalakan ulang saat browser masih terbuka → cookie lama tidak dikenal → dialihkan ke `/login`, bukan 500. Test di Task 4.
2. Header `Host` selain `127.0.0.1` atau `localhost` (serangan DNS rebinding) → 421 untuk semua rute web. `http://localhost:3000` dan `http://127.0.0.1:3000` sama-sama berfungsi. Test di Task 4.
3. Pencarian berisi `%` atau `_` → dicari sebagai karakter biasa, bukan wildcard. Test di Task 5.
4. `hal=abc`, `hal=0`, atau `hal=999` → halaman 1 atau tabel kosong dengan pesan, bukan 500. Test di Task 5.
5. Saringan `login=tidak-ada` → tabel kosong dengan pesan, bukan 500. Test di Task 5.

---

### Task 1: Skema — kredensial web dan pelaku `WEB_HUMAN`

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261112200000_web_ui/migration.sql`
- Test: `packages/database/src/schema.test.ts`

**Interfaces:**
- Produces:
  - `model UiCredential { id Int @id @default(1); passwordHash String; updatedAt DateTime @updatedAt; @@map("ui_credentials") }`
  - `AuditActor` bertambah `WEB_HUMAN`.

- [ ] **Step 1: Test yang gagal**

```ts
test("ui credentials hold one row and WEB_HUMAN is a valid audit actor", async () => {
  await db.uiCredential.create({ data: { passwordHash: "x" } });
  await expect(db.uiCredential.create({ data: { passwordHash: "y" } })).rejects.toThrow();
  await expect(db.auditLog.create({ data: { requestId: "w", actor: "WEB_HUMAN", action: "T", resource: "r", result: "ok" } })).resolves.toBeTruthy();
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Hentikan API. Ubah skema, buat migrasi dengan `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script`, lalu `corepack pnpm db:migrate` dan `corepack pnpm db:generate`.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add web credential table and WEB_HUMAN audit actor`.

### Task 2: Layanan bersama — angka inventaris, permintaan sinkron, pelaku verifikasi

**Files:**
- Create: `apps/api/src/services/inventory-report.ts`, `apps/api/src/services/sync-request.ts`
- Modify: `apps/api/src/routes/inventory.ts` (`/capacity` memakai layanan), `apps/api/src/routes/sync.ts` (memakai layanan), `apps/api/src/services/verify-login.ts` (parameter `actor`)
- Test: `apps/api/src/services/inventory-report.test.ts`, perubahan di `apps/api/src/sync.test.ts`

**Interfaces:**
- Produces:
  - `inventoryTotals(db: PrismaClient): Promise<{ logins: number; accounts: number; websites: number; wordpress: number }>` — aturan §4.2a spec: paket bukan `UNKNOWN`; website dari baris `websites` dengan status bukan `UNKNOWN` **dan** paket bukan `UNKNOWN`; WordPress = himpunan yang sama dengan `websiteType = WORDPRESS`.
  - `capacityReport(db: PrismaClient, login?: string): Promise<CapacityReport>` — bentuk sama dengan respons `/v1/capacity` sekarang (`totals`, `logins[]`, `expiringSoon[]`). Perbedaannya: `totals.websites` dan `logins[].totals.websites` dihitung dari baris website dengan aturan di atas, bukan dari `websiteCount`. `/v1/capacity` mengembalikan hasil fungsi ini apa adanya.
  - `requestSync(db: PrismaClient, input: { login?: string; actor: "CLAUDE_MCP" | "WEB_HUMAN"; requestId: string }): Promise<{ jobs: { id: string; status: string; created: boolean; login: string }[] } | null>` — `null` bila `login` diisi tetapi tidak dikenal. Satu baris audit `SYNC_REQUEST` per login: `resource: hostinger_login`, `resourceId: alias`, `result: queued` atau `already_queued`. `POST /v1/sync` memanggilnya dengan `actor: "CLAUDE_MCP"`.
  - `VerifyDeps` bertambah `actor?: "CLAUDE_MCP" | "WEB_HUMAN"` (bawaan `CLAUDE_MCP`), dipakai di semua baris audit verifikasi.

- [ ] **Step 1: Test yang gagal**

```ts
// inventory-report.test.ts — seed: login sumber; paket A (active) berisi 3 website (2 WORDPRESS, 1 UNKNOWN status website),
// paket C (status UNKNOWN) berisi 1 website ACTIVE
test("totals skip UNKNOWN plans and UNKNOWN websites", async () => {
  expect(await inventoryTotals(db)).toEqual({ logins: 1, accounts: 1, websites: 2, wordpress: 2 });
});
test("capacity totals match inventoryTotals", async () => {
  const report = await capacityReport(db);
  expect(report.totals).toEqual({ accounts: 1, websites: 2 });
});
test("requestSync audits each login and reports a repeat as already queued", async () => {
  await requestSync(db, { actor: "WEB_HUMAN", requestId: "r1" });
  await requestSync(db, { login: "sumber", actor: "WEB_HUMAN", requestId: "r2" });
  const rows = await db.auditLog.findMany({ where: { action: "SYNC_REQUEST" }, orderBy: { createdAt: "asc" } });
  expect(rows.map((r) => [r.actor, r.resourceId, r.result])).toEqual([["WEB_HUMAN", "sumber", "queued"], ["WEB_HUMAN", "sumber", "already_queued"]]);
  expect(await requestSync(db, { login: "tidak-ada", actor: "WEB_HUMAN", requestId: "r3" })).toBeNull();
});
```

Di `sync.test.ts`: tambah test bahwa `POST /v1/sync` menulis `SYNC_REQUEST` dengan pelaku `CLAUDE_MCP`. Sesuaikan harapan `totals.websites` di test kapasitas yang ada dengan jumlah baris website yang di-seed. Website diberi status `UNKNOWN` lewat `db.website.create({ data: { …, status: "UNKNOWN" } })`.

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan dan pindahkan logika `/capacity` ke `capacityReport`; route menjadi tipis.
- [ ] **Step 4:** Seluruh suite → PASS.
- [ ] **Step 5:** Commit `Share inventory totals and audit sync requests`.

### Task 3: Password web dan perintah `ops:ui:password`

**Files:**
- Create: `apps/api/src/services/ui-password.ts`, `apps/api/src/cli/ui-password.ts`
- Modify: `apps/api/src/cli/commands.ts`, `package.json` (skrip), `.claude/settings.json` (deny)
- Test: `apps/api/src/services/ui-password.test.ts`, tambahan di `apps/api/src/cli/commands.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(password: string): Promise<string>` → `scrypt$16384$8$1$<salt base64>$<hash base64>` (salt 16 byte, panjang kunci 64).
  - `verifyPassword(password: string, stored: string): Promise<boolean>` — membaca parameter dari string tersimpan; perbandingan `timingSafeEqual`; format tak dikenal → `false`.
  - `setUiPassword(db: PrismaClient, password: string): Promise<void>` — panjang < 12 → `Error("Password must be at least 12 characters")`; upsert `ui_credentials` `id = 1`; audit `UI_PASSWORD_SET` (`CLI_HUMAN`, `resource: ui_credentials`, `result: set`).
  - `getUiCredential(db: PrismaClient): Promise<{ passwordHash: string; updatedAt: Date } | null>`
  - `uiPasswordCommand(db: PrismaClient, io: CliIo): Promise<string>` — `assertInteractive` dulu; `readHidden("New web password: ")` lalu `readHidden("Repeat the password: ")`; beda → `Error("Passwords do not match")`; berhasil → `"Web password set. Open http://127.0.0.1:3000/ and log in."`.
  - Skrip root `"ops:ui:password": "node apps/api/dist/cli/ui-password.js"`; deny `Bash(pnpm ops:ui:*)` dan `Bash(corepack pnpm ops:ui:*)`.

- [ ] **Step 1: Test yang gagal**

```ts
test("hash round-trips and hides the password", async () => {
  const stored = await hashPassword("kata sandi panjang 1");
  expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  expect(stored).not.toContain("kata sandi");
  expect(await verifyPassword("kata sandi panjang 1", stored)).toBe(true);
  expect(await verifyPassword("kata sandi panjang 2", stored)).toBe(false);
  expect(await verifyPassword("x", "bukan-format")).toBe(false);
});
test("setUiPassword rejects short passwords and audits without the password", async () => {
  await expect(setUiPassword(db, "pendek")).rejects.toThrow("Password must be at least 12 characters");
  await setUiPassword(db, "kata sandi panjang 1");
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("kata sandi");
});
// commands.test.ts
test("ui:password refuses a piped stdin", async () => {
  await expect(uiPasswordCommand(db, { args: [], stdin: { isTTY: false }, readHidden: vi.fn() })).rejects.toThrow("Run this command in your own terminal");
});
test("ui:password rejects two different entries", async () => {
  const readHidden = vi.fn().mockResolvedValueOnce("kata sandi panjang A").mockResolvedValueOnce("kata sandi panjang B");
  await expect(uiPasswordCommand(db, { args: [], stdin: { isTTY: true }, readHidden })).rejects.toThrow("Passwords do not match");
});
test("ui:password stores a verifiable hash", async () => {
  const readHidden = vi.fn().mockResolvedValue("kata sandi panjang 3");
  await uiPasswordCommand(db, { args: [], stdin: { isTTY: true }, readHidden });
  expect(await verifyPassword("kata sandi panjang 3", (await getUiCredential(db))!.passwordHash)).toBe(true);
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan dengan `crypto.scrypt` (promisify) dan entri CLI yang memanggil `runCli`.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add web password command`.

### Task 4: Login, sesi, dan pembagian autentikasi

**Files:**
- Create: `apps/api/src/web/session.ts`, `apps/api/src/web/guard.ts`, `apps/api/src/web/auth-routes.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/web/auth.test.ts`

**Interfaces:**
- Produces:
  - `createSessionStore(opts?: { idleMs?: number; now?: () => number }): SessionStore`; `SessionStore = { create(): string; get(token: string): { createdAt: number } | null; destroy(token: string): void }`. Bawaan `idleMs` 8 jam. `get` memperpanjang `lastSeenAt`. Yang disimpan hanya SHA-256 token (32 byte acak, hex).
  - `createLoginThrottle(opts?: { maxFailures?: number; windowMs?: number; lockMs?: number; now?: () => number }): LoginThrottle`; `LoginThrottle = { isLocked(): boolean; recordFailure(): void; reset(): void }`. Bawaan 5 kali / 15 menit / kunci 5 menit.
  - `readCookie(header: string | undefined, name: string): string | undefined`
  - `isAllowedHost(host: string | undefined): boolean` — hostname (tanpa port) `127.0.0.1` atau `localhost`.
  - `isSameOriginPost(headers: IncomingHttpHeaders): boolean` — `sec-fetch-site === "same-origin"`, atau `Origin` yang hostname-nya lolos `isAllowedHost`.
  - `safeReturnPath(value: unknown): string` — diawali `/` tetapi bukan `//`, dan tanpa `:` sebelum `/` pertama; selain itu `"/ringkasan"`.
  - `AppDeps` bertambah `sessions?: SessionStore` dan `throttle?: LoginThrottle`; `buildApp` membuat bawaannya.
  - Hook `onRequest` di `app.ts`:
    - `/health` bebas;
    - `/v1/*` wajib `x-api-key` (cookie diabaikan);
    - selain itu (rute web) wajib `isAllowedHost` (bila gagal 421) dan, untuk `POST`, wajib `isSameOriginPost` (bila gagal 403);
    - `/login` dan `/assets/*` bebas sesi;
    - sisanya wajib sesi yang valid dan dibuat **setelah** `ui_credentials.updatedAt`. Tanpa sesi: `GET` → 302 ke `/login`, `POST` → 401.
  - Header di semua respons web: `Content-Security-Policy: default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, `Cache-Control: no-store`, `Referrer-Policy: same-origin`, `X-Content-Type-Options: nosniff`.
  - Rute:
    - `GET /login` — form, atau petunjuk `corepack pnpm ops:ui:password` bila belum ada password;
    - `POST /login` — field `password`;
      - berhasil: set cookie `ops_session=<token>; HttpOnly; SameSite=Strict; Path=/`, 303 ke `/ringkasan`;
      - salah: 401 dengan form dan pesan;
      - terkunci: 429 dengan pesan;
      - audit `UI_LOGIN`, `WEB_HUMAN`, result `ok`/`wrong_password`/`locked`;
    - `POST /logout` — hapus sesi dan cookie, 303 ke `/login`;
    - `GET /` → 302 ke `/ringkasan`.
  - Content-type parser `application/x-www-form-urlencoded` → objek dari `URLSearchParams`, batas 16 KB.

- [ ] **Step 1: Test yang gagal** (`app.inject`, header `origin: http://127.0.0.1:3000` untuk POST kecuali disebut lain; `/ringkasan` boleh membalas 200 dengan isi sementara sampai Task 5)

```ts
test("without a session GET goes to /login and POST is 401");
test("correct password sets an HttpOnly SameSite=Strict cookie and opens /ringkasan");
test("wrong password stays on /login with 401 and audits wrong_password");
test("the sixth failure in 15 minutes is locked with 429");
test("before any password exists /login explains ops:ui:password");
test("a session cookie does not open /v1/logins and an api key does not open /ringkasan");
test("POST with a foreign Origin, or with no Origin and no Sec-Fetch-Site, is 403; Sec-Fetch-Site same-origin passes");
test("a Host header other than 127.0.0.1 or localhost is 421");
test("localhost and 127.0.0.1 both work");
test("an unknown or stale cookie (API restarted) redirects to /login");
test("changing the password ends sessions created before it");
test("a session idle for more than 8 hours expires (fake clock)");
test("web responses carry the security headers");
test("safeReturnPath keeps /paket?login=a and rejects //evil.com, https://evil.com and javascript:x");
test("logout clears the session");
```

Setiap judul di atas adalah satu `test` dengan pernyataan yang sesuai judulnya. Status yang diperiksa persis: 302, 303, 401, 403, 421, 429.

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan. Pastikan test M1–M3 untuk `/v1/*` tetap lolos tanpa perubahan.
- [ ] **Step 4:** Seluruh suite → PASS.
- [ ] **Step 5:** Commit `Add web login and session guard`.

### Task 5: Halaman

**Files:**
- Create: `apps/api/src/web/html.ts`, `apps/api/src/web/layout.ts`, `apps/api/src/web/format.ts`, `apps/api/src/web/pages.ts`, `apps/api/src/web/assets/app.css` (disalin ke `dist` lewat skrip `build` atau dibaca dari `src` saat runtime — pilih satu dan uji lewat `GET /assets/app.css`)
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/web/html.test.ts`, `apps/api/src/web/pages.test.ts`

**Interfaces:**
- Produces:
  - `class SafeHtml { constructor(readonly value: string) }`; `html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml` — nilai `SafeHtml` disisipkan apa adanya; array digabung (tiap elemen diperlakukan sama); `null`/`undefined` menjadi string kosong; selain itu di-escape (`& < > " '`).
  - `layout(opts: { title: string; active: "ringkasan" | "paket" | "website" | "sinkron"; message?: string; body: SafeHtml }): string`
  - `formatDateTime(date: Date | null): string`, `formatRelativeDays(date: Date | null, now?: Date): string` (`"3 hari lagi"`, `"hari ini"`, `"lewat 2 hari"`, `"—"`).
  - Halaman: `GET /ringkasan`, `/paket`, `/website`, `/website/:domain`, `/sinkron`, `GET /assets/app.css` (`text/css`), sesuai §4.2 dan §4.2a spec. Data dari `inventoryTotals`, `capacityReport`, `loginSummaries`, Prisma.
  - Pencarian website: escape `%`, `_`, `\` lalu `contains` dengan `mode: "insensitive"`. Bila `contains` Prisma sudah meng-escape sendiri, buktikan dengan test dan jangan escape dua kali.
  - `hal` bukan bilangan bulat ≥ 1 → 1. Lebih dari halaman terakhir → tabel kosong dengan teks "Tidak ada website di halaman ini".
  - `/sinkron` menyembunyikan `HOSTINGER_API_CALL` kecuali `api=1`.

- [ ] **Step 0:** Muat skill `antislop:antislop`, `antislop:antislop-ui`, `antislop:antislop-copywriting`, `antislop:antislop-human`.
- [ ] **Step 1: Test yang gagal**

```ts
// html.test.ts
test("escapes interpolated values but keeps nested html", () => {
  expect(html`<td>${"<script>x</script>"}</td>${html`<b>${"&"}</b>`}`.value).toBe("<td>&lt;script&gt;x&lt;/script&gt;</td><b>&amp;</b>");
});
// pages.test.ts — login dulu (helper), seed: dua login, paket bersama, paket UNKNOWN, website <script>, job FAILED
test("ringkasan shows totals equal to /v1/capacity and the expiring plans");
test("paket lists shared plans with 'dibagi ke' and hides UNKNOWN plans, mentioning how many");
test("paket filtered by an unknown login shows an empty table with a message");
test("website search finds by part of a domain, case-insensitive, 50 per page");
test("website search treats % and _ literally");
test("website page numbers that are not positive integers fall back to page 1; past the end shows an empty message");
test("website hides UNKNOWN websites unless status=UNKNOWN is chosen");
test("website detail shows plan, owner login and provider metadata; unknown domain is 404");
test("a domain containing <script> is shown as text on every page");
test("sinkron shows a FAILED job with its error and hides HOSTINGER_API_CALL unless api=1");
test("app.css is served as text/css without a session");
```

Pernyataan tiap test memeriksa teks atau angka dari seed yang muncul di HTML respons (misalnya `toContain("dibagi ke")`, `toContain("&lt;script&gt;")`, `not.toContain("<script>x")`).

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan halaman dan CSS sesuai §4.6 spec dan aturan antislop.
- [ ] **Step 4:** Seluruh suite → PASS. Jalankan API, buka halaman di browser lewat Playwright, ambil tangkapan layar tiap halaman untuk pemeriksaan visual (kontras, fokus keyboard, layar sempit).
- [ ] **Step 5:** Commit `Add dashboard pages`.

### Task 6: Tombol aksi

**Files:**
- Create: `apps/api/src/web/actions.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/web/pages.ts` (form tombol)
- Test: `apps/api/src/web/actions.test.ts`

**Interfaces:**
- Consumes: `requestSync`, `verifyLogin` (`actor: "WEB_HUMAN"`), `safeReturnPath`.
- Produces:
  - `POST /aksi/sinkron` (field `login` opsional, `kembali`) → `requestSync` → 303 ke `safeReturnPath(kembali)` dengan `pesan` berisi "Sinkronisasi diantrekan untuk N login" atau "Sinkronisasi untuk <alias> sudah dalam antrean"; login tak dikenal → pesan "Login tidak ditemukan".
  - `POST /aksi/uji` (field `login` wajib, `kembali`) → `verifyLogin` → 303 dengan `pesan` berisi status dan `hint` bila ada.

- [ ] **Step 1: Test yang gagal**

```ts
test("Sinkronkan queues one job per login, a second press does not duplicate, both audited as WEB_HUMAN");
test("Uji koneksi runs verification with a fake fetch and reports the status, audited as WEB_HUMAN");
test("the return path is honoured for /paket?login=a and replaced for //evil.com");
test("action messages are escaped when shown");
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan.
- [ ] **Step 4:** Seluruh suite → PASS.
- [ ] **Step 5:** Commit `Add sync and connection test buttons`.

### Task 7: Uji pilot dengan pemilik

- [ ] **Step 1:** Agent: `corepack pnpm build`, nyalakan ulang API. Minta pemilik menjalankan `corepack pnpm ops:ui:password` di terminal sendiri, lalu membuka `http://127.0.0.1:3000/` dan login.
- [ ] **Step 2:** Pemilik mencoba keempat halaman dan kedua tombol, lalu memberi tahu apa yang kurang jelas.
- [ ] **Step 3:** Perbarui `docs/ARCHITECTURE.md` (rute web dan batas autentikasi), `docs/SECURITY.md` (sesi, CSRF, header, risiko yang diterima: sesi di memori dan HTTP lokal tanpa TLS), dan `MEMORY.md`. Commit `Document the web dashboard`.

## Di luar rencana ini

Akses dari jaringan lokal, banyak pengguna, grafik, mengedit data, aksi yang mengubah Hostinger.
