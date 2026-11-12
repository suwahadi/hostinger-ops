# M3 Inventaris & Laporan Kapasitas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Semua paket (order) dan website dari setiap login Hostinger tersinkron ke PostgreSQL lewat antrean yang tahan restart, tanpa merusak data bisnis, dan Claude bisa memicu sinkronisasi, melihat detail website, serta membaca laporan kapasitas dan paket yang mau habis.

**Architecture:** Antrean sederhana di tabel `jobs` PostgreSQL (`FOR UPDATE SKIP LOCKED`, dedupe lewat partial unique index). Paket baru `@ops/worker` berisi antrean, loop worker, dan prosesor `sync-login`; loop worker **berjalan di dalam proses API** sehingga pemilik cukup menjalankan `pnpm dev:api` dan pembatas laju 90/menit per login tetap satu di memori. Sinkronisasi membaca order, langganan (tanggal kedaluwarsa), dan website dengan paginasi, lalu menulis semuanya dalam satu transaksi.

**Tech Stack:** Sama dengan M2. Tidak ada dependensi baru.

**Spec:** `PRD.md` §4 prinsip 5–7, §5.2, §7.1, §7.2, §11.1, §12 M3. Aturan repo: `AGENT.md`.

## Global Constraints

- Pakai `corepack pnpm ...`. Sebelum commit: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` lolos.
- **API yang berjalan mengunci file engine Prisma.** Sebelum `prisma generate` atau `pnpm install` setelah skema berubah, hentikan API (lihat `MEMORY.md`, catatan operasional).
- Hanya request GET ke Hostinger. Paginasi `page` + `per_page=50`.
- Sinkronisasi hanya memperbarui data teknis provider. `projectId`, klien, proyek, aturan, catatan, dan kunci `metadata` di luar `metadata.provider` tidak pernah ditimpa atau dihapus (PRD §4 prinsip 5).
- Website atau paket yang tidak lagi muncul di respons API **tidak dihapus**; statusnya menjadi `UNKNOWN` (PRD §7.2). Penandaan ini hanya dilakukan bila **semua** halaman berhasil diambil.
- Setiap panggilan Hostinger dari worker tercatat di `AuditLog` dengan `actor: WORKER`, `requestId` = id job.
- Tidak ada identitas hosting sungguhan di kode, test, dokumen, atau commit.

## Data dari Hostinger (OpenAPI, dicek 12 Nov 2026)

| Endpoint | Field yang dipakai |
| :--- | :--- |
| `GET /api/hosting/v1/orders` → `{ data, meta }` | `id`, `status`, `plan.name`, `subscription_id` |
| `GET /api/billing/v1/subscriptions` → array | `id`, `status`, `expires_at`, `is_auto_renewed` |
| `GET /api/hosting/v1/websites` → `{ data, meta }` | `domain` (bisa null), `order_id`, `username`, `website_type` (`wordpress`, `builder`, `horizons`, `nodejs`, `other`), `is_enabled`, `root_directory`, `vhost_type`, `parent_domain` |

`meta` = `{ current_page, per_page, total }`. Pemakaian disk dan batas jumlah website **tidak tersedia** untuk shared hosting; `websiteLimit` dan `diskLimitMb` tetap null sampai diisi manual di milestone lain.

## Review Focus

1. Satu halaman gagal di tengah sinkronisasi (500 atau timeout di halaman 2) → tidak ada yang ditandai `UNKNOWN`, data lama utuh, job dicoba ulang. Test di Task 3.
2. Website pindah ke order lain di login yang sama → baris yang sama diperbarui (`projectId` tetap), bukan baris baru plus baris lama `UNKNOWN`. Test di Task 3.
3. PC tidur atau proses mati saat job berjalan → saat worker menyala lagi, job `RUNNING` kembali ke `QUEUED` dan dijalankan ulang; sinkronisasi aman diulang. Test di Task 2.
4. Sinkronisasi dipicu dua kali cepat untuk login yang sama → hanya satu job aktif; panggilan kedua mengembalikan job yang sama. Test di Task 2.
5. Website tanpa domain atau domain ganda di respons API → dilewati atau digabung, tidak crash, dihitung di hasil. Test di Task 3.

---

### Task 1: Skema — antrean, data paket, waktu sinkronisasi

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261112000000_inventory/migration.sql`
- Test: `packages/database/src/schema.test.ts`

**Interfaces:**
- Produces (nama field yang dipakai task lain):
  - `HostingerLogin.lastSyncedAt DateTime?`
  - `HostingAccount.status String?`, `.subscriptionId String?`, `.expiresAt DateTime?`, `.autoRenew Boolean?` (field lama `planType` diisi `plan.name`, `orderId` diisi id order, `code` = id order sebagai string, `username` dari website pertama order itu)
  - Model `Job` (`@@map("jobs")`): `id` uuid, `kind String`, `payload Json`, `dedupeKey String?`, `status String @default("QUEUED")` (`QUEUED`, `RUNNING`, `DONE`, `FAILED`), `attempts Int @default(0)`, `maxAttempts Int @default(3)`, `runAfter DateTime @default(now())`, `startedAt`, `finishedAt`, `result Json?`, `error String?`, `createdAt`, `updatedAt`; `@@index([status, runAfter])`.
  - SQL tambahan di migrasi: `CREATE UNIQUE INDEX "jobs_active_dedupe" ON "jobs" ("dedupeKey") WHERE "status" IN ('QUEUED', 'RUNNING');`

- [ ] **Step 1: Tulis test yang gagal** (tambahkan ke `schema.test.ts`)

```ts
test("only one active job per dedupe key", async () => {
  await db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } });
  await expect(db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } })).rejects.toThrow();
  await db.job.updateMany({ where: { dedupeKey: "sync-login:x" }, data: { status: "DONE" } });
  await expect(db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } })).resolves.toBeTruthy();
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Ubah skema. Hentikan API bila berjalan. Buat migrasi dengan `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (dari `packages/database`), tambahkan partial unique index, lalu `corepack pnpm db:migrate` dan `corepack pnpm db:generate`.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add job queue table and order subscription fields`.

### Task 2: Antrean dan loop worker

**Files:**
- Create: `apps/worker/package.json` (`@ops/worker`, dependensi `@ops/database`, `@ops/hostinger-adapter`, `@ops/shared`), `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`, `apps/worker/src/queue.ts`, `apps/worker/src/worker.ts`
- Modify: `tsconfig.json` (reference)
- Test: `apps/worker/src/queue.test.ts`, `apps/worker/src/worker.test.ts`

**Interfaces:**
- Produces:
  - `type JobRow = { id: string; kind: string; payload: unknown; attempts: number }`
  - `enqueueJob(db: PrismaClient, input: { kind: string; payload: object; dedupeKey?: string }): Promise<{ id: string; status: string; created: boolean }>` — bila sudah ada job aktif dengan `dedupeKey` sama, kembalikan job itu (`created: false`); tangani balapan lewat error unik (P2002) lalu baca ulang.
  - `claimNextJob(db: PrismaClient): Promise<JobRow | null>` — satu `UPDATE … WHERE id = (SELECT id FROM jobs WHERE status = 'QUEUED' AND "runAfter" <= now() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …`; menaikkan `attempts`, mengisi `startedAt`.
  - `completeJob(db, id: string, result: object): Promise<void>`
  - `failJob(db, job: JobRow, error: unknown, opts?: { permanent?: boolean; retryDelayMs?: number }): Promise<void>` — bila `permanent` atau `attempts >= maxAttempts` → `FAILED`; selain itu → `QUEUED` dengan `runAfter = now + retryDelayMs` (bawaan `30_000 * attempts`). `error` disimpan sebagai `message` saja, dipotong 500 karakter.
  - `recoverStaleJobs(db): Promise<number>` — semua `RUNNING` → `QUEUED` (hanya satu worker per PC).
  - `class PermanentJobError extends Error`
  - `type JobHandler = (job: JobRow) => Promise<object>`
  - `startWorker(opts: { db: PrismaClient; handlers: Record<string, JobHandler>; concurrency?: number; pollMs?: number; log?: (msg: string) => void }): { stop(): Promise<void> }` — bawaan `concurrency: 3`, `pollMs: 2000`; memanggil `recoverStaleJobs` sekali saat mulai; `kind` tanpa handler → `failJob(..., { permanent: true })`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// queue.test.ts
test("enqueue twice with the same dedupe key returns the same active job", async () => {
  const a = await enqueueJob(db, { kind: "sync-login", payload: { loginId: "l1" }, dedupeKey: "sync-login:l1" });
  const b = await enqueueJob(db, { kind: "sync-login", payload: { loginId: "l1" }, dedupeKey: "sync-login:l1" });
  expect(b).toEqual({ id: a.id, status: "QUEUED", created: false });
});
test("claim takes the oldest due job once", async () => {
  const job = await claimNextJob(db);
  expect(job).toMatchObject({ kind: "sync-login", attempts: 1 });
  expect(await claimNextJob(db)).toBeNull();
});
test("a failed job is retried later, then fails for good after maxAttempts", async () => {
  const { id } = await enqueueJob(db, { kind: "flaky", payload: {} });
  for (let i = 1; i <= 3; i++) {
    await db.job.update({ where: { id }, data: { runAfter: new Date(0) } });
    const job = (await claimNextJob(db))!;
    await failJob(db, job, new Error(`boom ${i}`));
  }
  expect(await db.job.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", attempts: 3, error: "boom 3" });
});
test("a permanent failure skips the retries", async () => {
  const { id } = await enqueueJob(db, { kind: "x", payload: {} });
  await db.job.update({ where: { id }, data: { runAfter: new Date(0) } });
  await failJob(db, (await claimNextJob(db))!, new PermanentJobError("no token"), { permanent: true });
  expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
});
test("stale RUNNING jobs go back to the queue", async () => {
  const { id } = await enqueueJob(db, { kind: "x2", payload: {} });
  await db.job.update({ where: { id }, data: { status: "RUNNING" } });
  expect(await recoverStaleJobs(db)).toBeGreaterThanOrEqual(1);
  expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("QUEUED");
});

// worker.test.ts
test("runs a queued job through its handler and stores the result", async () => {
  const { id } = await enqueueJob(db, { kind: "echo", payload: { n: 1 } });
  const worker = startWorker({ db, handlers: { echo: async (job) => ({ got: job.payload }) }, pollMs: 50 });
  await vi.waitFor(async () => expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("DONE"), { timeout: 5000 });
  await worker.stop();
  expect((await db.job.findUniqueOrThrow({ where: { id } })).result).toEqual({ got: { n: 1 } });
});
test("a job with no handler fails permanently", async () => {
  const { id } = await enqueueJob(db, { kind: "unknown-kind", payload: {} });
  const worker = startWorker({ db, handlers: {}, pollMs: 50 });
  await vi.waitFor(async () => expect((await db.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED"), { timeout: 5000 });
  await worker.stop();
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan. `stop()` menunggu job yang sedang berjalan selesai.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add Postgres job queue and worker loop`.

### Task 3: Prosesor sinkronisasi login

**Files:**
- Create: `packages/hostinger-adapter/src/pages.ts`, `apps/worker/src/processors/sync-login.ts`
- Modify: `packages/hostinger-adapter/src/index.ts`, `apps/worker/src/index.ts`
- Test: `packages/hostinger-adapter/src/pages.test.ts`, `apps/worker/src/processors/sync-login.test.ts`

**Interfaces:**
- Consumes: `HostingerClient`, `createHostingerClient`, `createTokenProvider`, `TokenUnavailableError`, `RateLimiter` (M2); `JobRow`, `PermanentJobError` (Task 2).
- Produces:
  - `class HostingerRequestError extends Error` dengan pesan `Hostinger GET <path> failed: <status atau error>`.
  - `getAllPages(client: HostingerClient, path: string, perPage?: number): Promise<unknown[]>` — mulai `page=1`, `per_page=50`; berhenti bila `data.length < per_page` atau `page * per_page >= meta.total`; status selain 200 → `HostingerRequestError`.
  - `getList(client: HostingerClient, path: string): Promise<unknown[]>` — untuk respons berupa array tanpa paginasi (subscriptions); selain 200 atau bukan array → `HostingerRequestError`.
  - `type SyncDeps = { db: PrismaClient; masterKey: Buffer; limiter: RateLimiter; fetch?: typeof fetch; sleep?: Sleep }`
  - `syncLoginInventory(deps: SyncDeps, job: JobRow): Promise<SyncResult>`, payload `{ loginId: string }`, `type SyncResult = { accounts: number; websites: number; markedUnknown: { accounts: number; websites: number }; skippedWithoutDomain: number }`.
- Aturan penulisan (satu `$transaction` setelah **semua** request berhasil):
  - Paket: upsert per `code = String(order.id)` dengan `loginId`, `orderId`, `planType = plan.name`, `status = order.status`, `subscriptionId`, `expiresAt`/`autoRenew` dari langganan yang `id`-nya sama, `username` dari website pertama order itu, `websiteCount`, `lastSyncedAt`. Paket login ini yang tidak muncul → `status: "UNKNOWN"`.
  - Website: lewati yang `domain` null; domain ganda dalam satu respons → ambil kemunculan pertama. Cari baris lama berdasarkan domain di antara **semua paket login ini**; bila ada, perbarui (termasuk `accountId`); bila tidak, buat. Kolom yang diperbarui: `accountId`, `webRoot = root_directory`, `status = is_enabled ? "ACTIVE" : "SUSPENDED"`, `websiteType = WORDPRESS` bila `website_type === "wordpress"` (selain itu nilai lama dibiarkan), `metadata = { ...lama, provider: { websiteType, vhostType, parentDomain, username } }`. Website paket-paket login ini yang tidak muncul → `status: "UNKNOWN"`.
  - `HostingerLogin.lastSyncedAt = now`.
  - Audit: tiap panggilan Hostinger `actor: WORKER`, `action: HOSTINGER_API_CALL`, `requestId: job.id`; satu baris penutup `action: SYNC_LOGIN`, `result: "OK"`, `detail: SyncResult`.
- Kesalahan: `TokenUnavailableError` → lempar `PermanentJobError` dengan pesan aslinya; `HostingerRequestError` → lempar apa adanya (dicoba ulang oleh antrean).

- [ ] **Step 1: Tulis test yang gagal**

```ts
// pages.test.ts — client palsu yang menjawab per (path, page)
test("follows pages until a short page", async () => {
  const client = pagedClient({ 1: 50 items, 2: 7 items });
  expect(await getAllPages(client, "/api/hosting/v1/websites")).toHaveLength(57);
  expect(client.calls).toEqual([["/api/hosting/v1/websites", { page: 1, per_page: 50 }], ["/api/hosting/v1/websites", { page: 2, per_page: 50 }]]);
});
test("a failed page throws HostingerRequestError", async () => {
  await expect(getAllPages(failingOnPage(2, 500), "/x")).rejects.toThrow("Hostinger GET /x failed: 500");
});

// sync-login.test.ts — fetch palsu berbasis tabel path → respons; login "sumber" + token di vault
test("creates accounts with plan, expiry and username, and websites with WordPress detected", async () => {
  const result = await syncLoginInventory(deps(hostinger({
    orders: [{ id: 101, status: "active", plan: { name: "Premium" }, subscription_id: "sub-1" }],
    subscriptions: [{ id: "sub-1", status: "active", expires_at: "2026-12-01T00:00:00Z", is_auto_renewed: false }],
    websites: [
      { domain: "contoh.com", order_id: 101, username: "u1", website_type: "wordpress", is_enabled: true, root_directory: "/home/u1/domains/contoh.com/public_html" },
      { domain: null, order_id: 101, website_type: "other", is_enabled: true },
    ],
  })), job());
  expect(result).toEqual({ accounts: 1, websites: 1, markedUnknown: { accounts: 0, websites: 0 }, skippedWithoutDomain: 1 });
  expect(await db.hostingAccount.findUniqueOrThrow({ where: { code: "101" } })).toMatchObject({
    planType: "Premium", status: "active", username: "u1", websiteCount: 1, autoRenew: false, expiresAt: new Date("2026-12-01T00:00:00Z"),
  });
  expect(await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).toMatchObject({ websiteType: "WORDPRESS", status: "ACTIVE" });
});
test("keeps projectId and moves a website to its new order instead of duplicating it", async () => {
  const project = await db.project.create({ data: { code: "P1", name: "Proyek" } });
  await db.website.updateMany({ where: { domain: "contoh.com" }, data: { projectId: project.id } });
  await syncLoginInventory(deps(hostinger({
    orders: [{ id: 101, status: "active", plan: { name: "Premium" } }, { id: 102, status: "active", plan: { name: "Business" } }],
    subscriptions: [],
    websites: [{ domain: "contoh.com", order_id: 102, username: "u2", website_type: "wordpress", is_enabled: true }],
  })), job());
  const rows = await db.website.findMany({ where: { domain: "contoh.com" }, include: { account: true } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ projectId: project.id, account: { code: "102" } });
});
test("marks missing websites and accounts UNKNOWN instead of deleting them", async () => {
  const result = await syncLoginInventory(deps(hostinger({ orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [] })), job());
  expect(result.markedUnknown).toEqual({ accounts: 1, websites: 1 });
  expect((await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).status).toBe("UNKNOWN");
});
test("a failed page writes nothing and throws for a retry", async () => {
  const before = await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } });
  await expect(syncLoginInventory(deps(hostingerFailing("/api/hosting/v1/websites", 500)), job())).rejects.toThrow("Hostinger GET /api/hosting/v1/websites failed: 500");
  expect(await db.website.findFirstOrThrow({ where: { domain: "contoh.com" } })).toEqual(before);
});
test("duplicate domains in one response are merged", async () => {
  const site = { domain: "ganda.com", order_id: 102, username: "u2", website_type: "other", is_enabled: true };
  const result = await syncLoginInventory(deps(hostinger({
    orders: [{ id: 102, status: "active", plan: { name: "Business" } }], subscriptions: [], websites: [site, { ...site }],
  })), job());
  expect(result.websites).toBe(1);
  expect(await db.website.count({ where: { domain: "ganda.com" } })).toBe(1);
});
test("a login without a stored token fails permanently", async () => {
  await db.hostingerLogin.create({ data: { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" } });
  await expect(syncLoginInventory(deps(vi.fn()), job("tujuan"))).rejects.toBeInstanceOf(PermanentJobError);
});
test("every Hostinger call is audited as WORKER under the job id, without the token", async () => {
  const j = job();
  await syncLoginInventory(deps(hostinger({ orders: [], subscriptions: [], websites: [] })), j);
  const audit = await db.auditLog.findMany({ where: { requestId: j.id } });
  expect(audit.filter((a) => a.action === "HOSTINGER_API_CALL" && a.actor === "WORKER")).toHaveLength(3);
  expect(audit.find((a) => a.action === "SYNC_LOGIN")?.result).toBe("OK");
  expect(JSON.stringify(audit)).not.toContain(token);
});
```

Helper lokal di test: `hostinger({ orders, subscriptions, websites })` membuat `fetch` palsu yang menjawab `/api/hosting/v1/orders` dan `/api/hosting/v1/websites` dengan `{ data, meta: { current_page: 1, per_page: 50, total: n } }` dan `/api/billing/v1/subscriptions` dengan array; `hostingerFailing(path, status)` sama tetapi path itu membalas status tersebut; `job(alias = "sumber")` membuat `JobRow` dengan id uuid baru dan payload `{ loginId }`; `deps(fetch)` memakai limiter tanpa batas dan `sleep` instan. Login `sumber` dan tokennya di-seed langsung via Prisma + `encryptSecret` (layanan `addLogin`/`storeSecret` ada di `apps/api`, bukan dependensi worker).

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan `pages.ts` dan prosesor. Bentuk respons divalidasi dengan Zod; item yang field wajibnya salah (`order.id` bukan angka, `website.order_id` bukan angka) → `HostingerRequestError("Hostinger GET <path> returned an unexpected response shape")`, sehingga tidak ada yang ditulis.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add login inventory sync processor`.

### Task 4: Route API, worker di proses API, dan ringkasan login

**Files:**
- Create: `apps/api/src/routes/sync.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/inventory.ts`, `apps/api/package.json` (dependensi `@ops/worker`), `apps/api/tsconfig.json`, `packages/shared/src/schemas.ts`
- Test: `apps/api/src/sync.test.ts`, perubahan di `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: Task 2 (`enqueueJob`, `startWorker`), Task 3 (`syncLoginInventory`).
- Produces:
  - `LoginSummary` bertambah `lastSyncedAt: string | null` dan `sync: { jobId: string; status: string; error: string | null; finishedAt: string | null } | null` (job `sync-login` terbaru login itu).
  - `AccountSummary` bertambah `username: string | null`, `status: string | null`, `expiresAt: string | null`, `autoRenew: boolean | null`.
  - `WebsiteDetail` (skema baru) = `WebsiteSummary` + `loginAlias`, `webRoot`, `metadata`, `createdAt`, `updatedAt`.
  - `POST /v1/sync` body `{ login?: string }` → `{ jobs: { id, login, status, created }[] }`; tanpa `login` → satu job per login (`dedupeKey: "sync-login:<loginId>"`); alias tak dikenal → 404 `login_not_found`.
  - `GET /v1/websites/:domain` → `{ websites: WebsiteDetail[] }` (domain persis, tidak peka huruf besar; bisa lebih dari satu baris bila domain ada di beberapa login); tidak ada → 404 `website_not_found`.
  - `GET /v1/capacity?login=` → `{ logins: { alias, totals: { accounts, websites }, accounts: AccountSummary[] }[], expiringSoon: AccountSummary[] }`; `accounts` urut `websiteCount` naik; `expiringSoon` = paket ber-`expiresAt` dalam 30 hari ke depan, urut tanggal.
  - `server.ts` memanggil `startWorker({ db, handlers: { "sync-login": (job) => syncLoginInventory({ db, masterKey, limiter }, job) } })` setelah `listen`, dengan **limiter yang sama** dengan route verify: `server.ts` membuat satu `createRateLimiter(HOSTINGER_RATE_LIMIT)` dan memberikannya ke `buildApp({ …, limiter })` dan ke handler worker. `SIGINT`/`SIGTERM` → `worker.stop()` lalu `app.close()`.
  - Hapus komentar `shortcut:` di `rate-limiter.ts`; ganti dengan komentar satu baris bahwa semua panggilan Hostinger berjalan di satu proses (API + worker).

- [ ] **Step 1: Tulis test yang gagal** (`sync.test.ts`, `buildApp` dengan test DB, tanpa worker berjalan)

```ts
test("POST /v1/sync queues one job per login and dedupes a repeat", async () => {
  const first = (await post("/v1/sync", {})).json().jobs;
  expect(first.map((j: { login: string }) => j.login).sort()).toEqual(["sumber", "tujuan"]);
  const again = (await post("/v1/sync", { login: "sumber" })).json().jobs;
  expect(again).toEqual([expect.objectContaining({ id: first.find((j: { login: string }) => j.login === "sumber").id, created: false })]);
});
test("POST /v1/sync for an unknown login is 404", async () => {
  expect((await post("/v1/sync", { login: "tidak-ada" })).statusCode).toBe(404);
});
test("list_logins shows the latest sync job", async () => {
  expect((await get("/v1/logins")).json().logins[0].sync).toMatchObject({ status: "QUEUED", error: null });
});
test("website details match the domain case-insensitively", async () => {
  expect((await get("/v1/websites/CONTOH.COM")).json().websites[0]).toMatchObject({ domain: "contoh.com", loginAlias: "sumber", webRoot: expect.any(String) });
  expect((await get("/v1/websites/tidak-ada.com")).statusCode).toBe(404);
});
test("capacity lists accounts by fewest websites and flags plans expiring within 30 days", async () => {
  // seed: A (3 website, expires +10 hari), B (1 website, expires +90 hari)
  const body = (await get("/v1/capacity")).json();
  expect(body.logins[0].accounts.map((a: { code: string }) => a.code)).toEqual(["B", "A"]);
  expect(body.expiringSoon.map((a: { code: string }) => a.code)).toEqual(["A"]);
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan. Perbarui test M1/M2 yang memeriksa bentuk `LoginSummary`/`AccountSummary` persis.
- [ ] **Step 4:** Jalankan seluruh suite → PASS.
- [ ] **Step 5:** Commit `Add sync, website detail and capacity routes`.

### Task 5: Tool MCP inventaris

**Files:**
- Modify: `apps/mcp-server/src/client.ts` (`post` menerima body JSON opsional), `apps/mcp-server/src/tools/inventory.ts`
- Test: `apps/mcp-server/src/tools/inventory.test.ts`

**Interfaces:**
- Produces: `ApiClient.post(path, opts?: { timeoutMs?: number; body?: object })` — bila ada `body`, kirim `content-type: application/json`. Tool baru:
  - `trigger_inventory_sync` (`login?: string`) → `POST /v1/sync`. Deskripsi: sinkronisasi berjalan di latar belakang; cek `list_logins` (`sync.status`, `lastSyncedAt`).
  - `get_website_details` (`domain: string`) → `GET /v1/websites/<domain ter-encode>`.
  - `get_capacity_report` (`login?: string`) → `GET /v1/capacity`.

- [ ] **Step 1: Tulis test yang gagal** — daftar tool menjadi delapan nama; `trigger_inventory_sync` mengirim `POST` ke `/v1/sync` dengan body `{"login":"sumber"}` dan header `content-type: application/json`; tanpa argumen body `{}`; `get_website_details` meng-encode domain; `get_capacity_report` meneruskan `login` sebagai query.
- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan.
- [ ] **Step 4:** Jalankan → PASS; `corepack pnpm build`.
- [ ] **Step 5:** Commit `Add inventory sync, website detail and capacity MCP tools`.

### Task 6: Sinkronisasi pilot

- [ ] **Step 1:** Agent: hentikan API lama, `corepack pnpm build`, nyalakan `corepack pnpm dev:api` (API + worker). Minta pemilik menjalankan `/mcp`.
- [ ] **Step 2:** Agent memanggil `trigger_inventory_sync` tanpa argumen, lalu `list_logins` sampai kedua login `sync.status: "DONE"` (atau `FAILED` dengan error yang terbaca).
- [ ] **Step 3:** Agent memanggil `get_capacity_report` dan menampilkan ringkasan ke pemilik: jumlah paket dan website per login, paket yang habis dalam 30 hari. **Minta pemilik mencocokkan jumlah paket dan website dengan hPanel** — ini membuktikan apakah daftar order bawaan sudah memuat semua status.
- [ ] **Step 4:** Jalankan sinkronisasi kedua; pastikan tidak ada baris baru dan tidak ada yang berubah menjadi `UNKNOWN` (DoD M3).
- [ ] **Step 5:** Perbarui `docs/API-CAPABILITIES.md` (tanpa alias dan domain), `docs/ARCHITECTURE.md` (worker di proses API), `MEMORY.md`. Commit `Record pilot inventory sync`.

## Di luar rencana ini

Deteksi Laravel dan versi PHP lewat SSH (M4/M7), batas website dan disk per paket (tidak tersedia di API shared hosting), jadwal sinkronisasi otomatis (M8), memori klien dan proyek (M5).
