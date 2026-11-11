# M1 Fondasi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo yang bisa dibangun, PostgreSQL lokal dengan skema lengkap, API Fastify ber-autentikasi, dan MCP server dengan empat tool baca yang tersambung ke Claude Code.

**Architecture:** MCP server (STDIO) hanya memanggil API lokal `127.0.0.1:3000` dengan kunci internal; API membaca PostgreSQL lewat Prisma. Tidak ada panggilan ke Hostinger di M1. Worker, antrean, dan adapter Hostinger/SSH belum dibuat (M2–M4).

**Tech Stack:** Node.js ≥22.12, pnpm 10.20 (lewat corepack), TypeScript 6.0.x, Prisma 6.19.x + PostgreSQL 17, Fastify 5, Zod 4, `@modelcontextprotocol/server` 2.4.x, Vitest 4.

**Spec:** `PRD.md` (v2.0 FINAL) §4, §5, §6, §7, §8, §11.1, §12 M1. Aturan repo: `AGENT.md`.

## Global Constraints

- Hasil cek 11 Nov 2026: PC ini memakai Node v22.23.2; semua paket di atas mendukung Node 22. `engines.node` = `>=22.12.0` (PRD §5.1: versi adalah sasaran, bukan kunci). pnpm belum terpasang: pakai `corepack pnpm ...` dan `"packageManager": "pnpm@10.20.0"`.
- Prisma CLI dan Client dikunci pada versi 6.19.x yang sama.
- TypeScript `strict: true`, `module: NodeNext`, `target: ES2023`. Semua paket ESM (`"type": "module"`).
- PostgreSQL dan API hanya terikat ke `127.0.0.1`.
- Token, kunci utama, dan isi `.env` tidak pernah muncul di respons, log, pesan error, test, atau commit (PRD §4.1, AGENT.md §2). Tidak ada username hosting, IP, atau domain sungguhan; pakai `sumber`, `tujuan`, `contoh.com`.
- MCP server tidak menulis apa pun ke stdout selain protokol; log ke stderr.
- Komentar kode: hanya untuk hal yang tidak terlihat dari kode (AGENT.md §1).
- Commit: bahasa Inggris, kalimat perintah, huruf awal kapital, ≤72 karakter, **tanpa atribusi AI**. Sebelum commit: `pnpm typecheck && pnpm test && pnpm build` lolos. Branch `main`. Remote belum ada: commit saja.
- `pnpm typecheck` harus lolos di clone bersih tanpa `pnpm build` lebih dulu (saran: `tsc -b` dengan project references).
- `pnpm test` membutuhkan `pnpm infra:up`. Test database memakai schema PostgreSQL `test`, bukan `public`.

## Review Focus

1. Kunci API dengan panjang berbeda dari yang benar → 401, bukan 500 (`timingSafeEqual` melempar bila panjang beda). Test di Task 4.
2. `SECRETS_MASTER_KEY` kosong, bukan hex, atau bukan 32 byte → gagal dengan pesan jelas yang tidak memuat nilai kuncinya. Test di Task 2.
3. `cipherText` atau `authTag` yang diubah → `decryptSecret` melempar, tidak pernah mengembalikan data rusak. Test di Task 2.
4. API lokal mati atau membalas 401/500 → tool MCP mengembalikan hasil `isError` yang terbaca; proses MCP tetap hidup. Test di Task 5.
5. Port 5432 sudah dipakai layanan lain di PC (Laragon) → port host bisa diganti lewat `OPS_PG_PORT` tanpa mengubah file compose. Verifikasi di Task 3.

---

### Task 1: Kerangka repositori

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.gitattributes`, `.env.example`, `.githooks/commit-msg`, `CLAUDE.md`, `.claude/settings.json`, `data/backups/.gitkeep`, `data/exports/.gitkeep`
- Test: `tests/commit-msg-hook.test.ts`

**Interfaces:**
- Produces: skrip root `infra:up`, `infra:down`, `db:generate`, `db:migrate`, `typecheck`, `build`, `test`, `dev:api`; workspace `apps/*` dan `packages/*`; nama paket `@ops/shared`, `@ops/database`, `@ops/api`, `@ops/mcp-server`.
- Produces: variabel `.env.example`: `POSTGRES_PASSWORD`, `OPS_PG_PORT=5432`, `DATABASE_URL`, `HOSTING_OPS_API_KEY`, `SECRETS_MASTER_KEY` (64 karakter hex), `API_PORT=3000`, `NODE_ENV=development`.

- [ ] **Step 1:** `git init -b main`; `git config core.hooksPath .githooks` (lokal). Jangan menyentuh konfigurasi global.
- [ ] **Step 2: Tulis test hook yang gagal**

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

function runHook(message: string): number {
  const file = join(mkdtempSync(join(tmpdir(), "hook-")), "MSG");
  writeFileSync(file, message);
  try { execFileSync("sh", [".githooks/commit-msg", file]); return 0; }
  catch (e) { return (e as { status: number }).status; }
}

test("accepts a plain message", () => {
  expect(runHook("Add shared crypto module\n")).toBe(0);
});
test.each([
  "Add x\n\nCo-authored-by: Claude <noreply@anthropic.com>\n",
  "Add x\n\nCo-Authored-By: Copilot <x@github.com>\n",
  "Add x\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n",
])("rejects AI attribution: %s", (m) => {
  expect(runHook(m)).not.toBe(0);
});
```

- [ ] **Step 3:** Jalankan `corepack pnpm vitest run tests/commit-msg-hook.test.ts` → FAIL (hook belum ada).
- [ ] **Step 4:** Tulis `.githooks/commit-msg` (POSIX sh, LF): `grep -Eiq` terhadap `co-authored-by:.*(claude|anthropic|chatgpt|openai|copilot|gemini|cursor)` dan `generated with` → exit 1 dengan pesan ke stderr.
- [ ] **Step 5:** Tulis file konfigurasi lain:
  - `.gitattributes`: `* text=auto eol=lf`.
  - `.gitignore`: `node_modules`, `dist`, `.env`, `.env.*` kecuali `.env.example`, `data/backups/*`, `data/exports/*` kecuali `.gitkeep`, `*.tsbuildinfo`, `.claude/settings.local.json`.
  - `CLAUDE.md`: satu baris impor `@AGENT.md`, pointer ke `PRD.md`, dan tiga larangan: jangan membaca `.env`, jangan menjalankan `ops:approve`/`ops:reject`/`ops:secret:*`, jangan menulis identitas hosting sungguhan.
  - `.claude/settings.json`: `permissions.deny` = `Read(./.env)`, `Bash(pnpm ops:approve:*)`, `Bash(pnpm ops:reject:*)`, `Bash(pnpm ops:secret:*)`, `Bash(corepack pnpm ops:approve:*)`, `Bash(corepack pnpm ops:reject:*)`, `Bash(corepack pnpm ops:secret:*)`; atribusi commit dan PR dimatikan. Verifikasi nama kunci pengaturan atribusi terhadap dokumentasi Claude Code sebelum menulis.
- [ ] **Step 6:** `corepack pnpm install`; jalankan ulang test → PASS.
- [ ] **Step 7:** Commit `Scaffold monorepo with commit hook and agent rules` (sertakan `PRD.md`, `AGENT.md`, `docs/`).

### Task 2: `@ops/shared` — enkripsi dan skema

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`, `packages/shared/src/crypto.ts`, `packages/shared/src/schemas.ts`
- Test: `packages/shared/src/crypto.test.ts`

**Interfaces:**
- Produces:
  - `parseMasterKey(hex: string | undefined): Buffer` — melempar `Error("SECRETS_MASTER_KEY must be 64 hex characters")`.
  - `encryptSecret(plain: string, key: Buffer): EncryptedSecret` dengan `type EncryptedSecret = { cipherText: string; iv: string; authTag: string }` (semua base64; IV 12 byte acak; tag 16 byte).
  - `decryptSecret(secret: EncryptedSecret, key: Buffer): string`.
  - Skema Zod + tipe: `LoginSummary { alias, status, lastVerifiedAt }`, `AccountSummary { code, loginAlias, planType, datacenter, websiteCount, websiteLimit, lastSyncedAt }`, `WebsiteSummary { domain, accountCode, websiteType, status, phpVersion, projectCode }`, `CapabilitySummary { name, available, httpStatus, note, checkedAt }`. Tanggal sebagai string ISO atau `null`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
const key = parseMasterKey("ab".repeat(32));

test("round-trips a secret", () => {
  expect(decryptSecret(encryptSecret("rahasia-123", key), key)).toBe("rahasia-123");
});
test("uses a fresh 12-byte IV each time", () => {
  const a = encryptSecret("x", key), b = encryptSecret("x", key);
  expect(a.iv).not.toBe(b.iv);
  expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
  expect(Buffer.from(a.authTag, "base64")).toHaveLength(16);
});
test("rejects tampered cipherText and authTag", () => {
  const s = encryptSecret("rahasia", key);
  const flip = (b64: string) => { const b = Buffer.from(b64, "base64"); b[0] ^= 1; return b.toString("base64"); };
  expect(() => decryptSecret({ ...s, cipherText: flip(s.cipherText) }, key)).toThrow();
  expect(() => decryptSecret({ ...s, authTag: flip(s.authTag) }, key)).toThrow();
});
test("rejects a wrong key", () => {
  expect(() => decryptSecret(encryptSecret("x", key), parseMasterKey("cd".repeat(32)))).toThrow();
});
test.each([undefined, "", "abc", "zz".repeat(32), "ab".repeat(31)])("rejects master key %s without echoing it", (bad) => {
  expect(() => parseMasterKey(bad)).toThrow("SECRETS_MASTER_KEY must be 64 hex characters");
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan dengan `node:crypto` (`aes-256-gcm`); tulis skema di `schemas.ts`.
- [ ] **Step 4:** Jalankan → PASS; `corepack pnpm typecheck` lolos.
- [ ] **Step 5:** Commit `Add shared crypto module and response schemas`.

### Task 3: PostgreSQL dan `@ops/database`

**Files:**
- Create: `infra/docker-compose.yml`, `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/prisma/schema.prisma`, `packages/database/prisma/migrations/**`, `packages/database/src/index.ts`, `packages/database/src/test-db.ts`
- Test: `packages/database/src/schema.test.ts`

**Interfaces:**
- Produces: `export { PrismaClient, Prisma }` dan `createDb(url?: string): PrismaClient` dari `@ops/database`; `createTestDb(): Promise<PrismaClient>` dari `@ops/database/test-db` (menjalankan `prisma migrate deploy` ke schema `test`, lalu mengosongkan tabel).
- Produces: model Prisma sesuai PRD §7.1 — `HostingerLogin`, `HostingCapability`, `HostingAccount`, `Website`, `WebsiteDatabase`, `Domain`, `DnsRecord`, `MigrationWave`, `MigrationJob`, `MigrationStep`, `Backup`, `Approval`, `OperationLock`, `SecretVault`, `AuditLog`, `Client`, `Project`, `ProjectRule`, `GlobalRule`, `KnowledgeItem`, `MonitoringCheck`; enum `SecretCategory`, `ApprovalStatus`, `WebsiteType`.
- Nama field yang dipakai task lain: `HostingerLogin.alias` (unik), `.status`, `.lastVerifiedAt`; `HostingAccount.code` (unik), `.loginId`, `.planType`, `.datacenter`, `.websiteCount`, `.websiteLimit`, `.lastSyncedAt`; `Website.domain`, `.accountId`, `.websiteType`, `.status`, `.phpVersion`, `.projectId`; `Project.code` (unik); `HostingCapability.name`, `.available`, `.httpStatus`, `.note`, `.checkedAt`, unik (`loginId`, `name`).

- [ ] **Step 1:** `infra/docker-compose.yml`: service `postgres`, image `postgres:17`, `container_name: ops-postgres`, port `127.0.0.1:${OPS_PG_PORT:-5432}:5432`, database `hostinger_ops`, password dari `POSTGRES_PASSWORD`, volume bernama, healthcheck `pg_isready`. Skrip root `infra:up` = `docker compose --env-file .env -f infra/docker-compose.yml up -d --wait`.
- [ ] **Step 2:** Buat `.env` lokal dari `.env.example` dengan nilai acak (`node -e` + `crypto.randomBytes`), tanpa mencetak nilainya. Jalankan `corepack pnpm infra:up` → `ops-postgres` berstatus `healthy`. Bila port bentrok, ubah `OPS_PG_PORT` dan `DATABASE_URL` di `.env`.
- [ ] **Step 3: Tulis test yang gagal**

```ts
const db = await createTestDb();

test("website is unique per account and domain", async () => {
  const login = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
  const account = await db.hostingAccount.create({ data: { code: "A001", loginId: login.id } });
  await db.website.create({ data: { accountId: account.id, domain: "contoh.com" } });
  await expect(db.website.create({ data: { accountId: account.id, domain: "contoh.com" } })).rejects.toThrow();
});
test("audit log rows cannot be updated or deleted", async () => {
  const row = await db.auditLog.create({ data: { requestId: "r1", actor: "CLI_HUMAN", action: "TEST", resource: "none", result: "OK" } });
  await expect(db.auditLog.update({ where: { id: row.id }, data: { result: "X" } })).rejects.toThrow();
  await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
});
test("secret vault refKey is unique", async () => {
  const data = { refKey: "K1", cipherText: "a", iv: "b", authTag: "c" };
  await db.secretVault.create({ data });
  await expect(db.secretVault.create({ data })).rejects.toThrow();
});
```

- [ ] **Step 4:** Jalankan → FAIL.
- [ ] **Step 5:** Tulis `schema.prisma` (semua model di atas; field wajib hanya yang disebut PRD §7.1, sisanya opsional atau ber-default). Buat migrasi awal dengan `prisma migrate dev --name init`; tambahkan ke SQL migrasi itu trigger `BEFORE UPDATE OR DELETE` pada tabel audit log yang memanggil `RAISE EXCEPTION`. Karena trigger itu, `createTestDb` mengosongkan tabel dengan `TRUNCATE` (trigger baris tidak berlaku untuk `TRUNCATE`).
- [ ] **Step 6:** Jalankan → PASS. `corepack pnpm db:migrate` bersih pada schema `public`.
- [ ] **Step 7:** Commit `Add Postgres compose file and Prisma schema`.

### Task 4: `@ops/api` — Fastify dengan autentikasi

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/config.ts`, `apps/api/src/routes/inventory.ts`
- Test: `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `createDb`, `createTestDb`, `PrismaClient` (Task 3); skema ringkasan dan `parseMasterKey` (Task 2).
- Produces: `buildApp(deps: { db: PrismaClient; apiKey: string }): FastifyInstance`; `loadConfig(env: NodeJS.ProcessEnv): { apiKey: string; port: number; masterKey: Buffer; databaseUrl: string }` (melempar bila `HOSTING_OPS_API_KEY` < 32 karakter).
- Produces: route, semua butuh header `x-api-key` kecuali `/health`:
  - `GET /health` → `{ status: "ok", database: "up" | "down" }`
  - `GET /v1/logins` → `{ logins: LoginSummary[] }`
  - `GET /v1/accounts?login=<alias>` → `{ accounts: AccountSummary[] }`
  - `GET /v1/websites?login=&account=&project=&domain=` → `{ websites: WebsiteSummary[] }` (`domain` = cocok sebagian, tidak peka huruf besar)
  - `GET /v1/logins/:alias/capabilities` → `{ capabilities: CapabilitySummary[] }`; alias tak dikenal → 404 `{ error: "login_not_found" }`
- `server.ts` mendengarkan di `127.0.0.1` saja.

- [ ] **Step 1: Tulis test yang gagal** (memakai `app.inject`, kunci `"k".repeat(40)`)

```ts
test("health needs no key", async () => {
  expect((await app.inject("/health")).json()).toEqual({ status: "ok", database: "up" });
});
test.each([undefined, "short", "x".repeat(40), "k".repeat(41)])("rejects key %s with 401", async (key) => {
  const res = await app.inject({ url: "/v1/logins", headers: key ? { "x-api-key": key } : {} });
  expect(res.statusCode).toBe(401);
});
test("lists logins without token references", async () => {
  await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
  const res = await app.inject({ url: "/v1/logins", headers: auth });
  expect(res.json().logins).toEqual([{ alias: "sumber", status: expect.any(String), lastVerifiedAt: null }]);
  expect(res.body).not.toContain("HOSTINGER_TOKEN");
});
test("filters websites by partial domain", async () => {
  // seed: login "sumber" → account "A001" → contoh.com, lain.org
  const res = await app.inject({ url: "/v1/websites?domain=CONTOH", headers: auth });
  expect(res.json().websites.map((w: { domain: string }) => w.domain)).toEqual(["contoh.com"]);
});
test("unknown login alias returns 404", async () => {
  const res = await app.inject({ url: "/v1/logins/tidak-ada/capabilities", headers: auth });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "login_not_found" });
});
test("errors do not leak internals", async () => {
  const broken = buildApp({ db: {} as never, apiKey: "k".repeat(40) });
  const res = await broken.inject({ url: "/v1/logins", headers: auth });
  expect(res.statusCode).toBe(500);
  expect(res.json()).toEqual({ error: "internal_error" });
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan. Autentikasi: bandingkan SHA-256 dari kedua kunci dengan `timingSafeEqual`, supaya panjang berbeda tidak melempar. Respons disusun lewat skema Zod dari `@ops/shared` (field di luar skema terbuang). Error handler mengembalikan `{ error: "internal_error" }` dan mencatat detailnya ke log server saja.
- [ ] **Step 4:** Jalankan → PASS. `corepack pnpm dev:api` lalu `curl http://127.0.0.1:3000/health` → `{"status":"ok","database":"up"}`.
- [ ] **Step 5:** Commit `Add local API with key auth and inventory routes`.

### Task 5: `@ops/mcp-server` — empat tool baca

**Files:**
- Create: `apps/mcp-server/package.json`, `apps/mcp-server/tsconfig.json`, `apps/mcp-server/src/index.ts`, `apps/mcp-server/src/client.ts`, `apps/mcp-server/src/env.ts`, `apps/mcp-server/src/tools/inventory.ts`, `.mcp.json`
- Test: `apps/mcp-server/src/tools/inventory.test.ts`, `apps/mcp-server/src/env.test.ts`

**Interfaces:**
- Consumes: route Task 4.
- Produces:
  - `readMcpEnv(envFileContent: string): { apiKey: string; apiUrl: string }` — mengambil **hanya** `HOSTING_OPS_API_KEY` dan `API_PORT` (bawaan 3000) memakai `util.parseEnv`; nilai lain di `.env` tidak pernah masuk ke proses MCP.
  - `createApiClient(opts: { apiUrl: string; apiKey: string; fetch?: typeof fetch }): { get(path: string, query?: Record<string, string | undefined>): Promise<unknown> }` — batas waktu 10 detik; melempar `ApiError` dengan `message` salah satu dari: `"Hostinger Ops API is not running. Start it with: pnpm dev:api"`, `"Hostinger Ops API rejected the internal key"`, `"Hostinger Ops API error (<status>)"`.
  - `inventoryTools(client)`: daftar `{ name, description, inputSchema (Zod), handler }` untuk `list_logins` (tanpa input), `list_accounts` (`login?`), `list_websites` (`login?`, `account?`, `project?`, `domain?`), `get_login_capabilities` (`login`). Handler mengembalikan `{ content: [{ type: "text", text: JSON }] }`, atau `{ isError: true, content: [{ type: "text", text: message }] }` bila client melempar.

- [ ] **Step 1:** Setelah `corepack pnpm install`, baca README dan tipe `@modelcontextprotocol/server` di `node_modules` untuk memastikan cara mendaftarkan tool dan transport stdio di versi 2.4. Jangan mengandalkan ingatan API versi 1.
- [ ] **Step 2: Tulis test yang gagal**

```ts
test("readMcpEnv exposes only the API key and URL", () => {
  const env = readMcpEnv("HOSTING_OPS_API_KEY=abc\nSECRETS_MASTER_KEY=zzz\nAPI_PORT=3100\n");
  expect(env).toEqual({ apiKey: "abc", apiUrl: "http://127.0.0.1:3100" });
});
test("list_websites forwards filters and returns JSON text", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ websites: [{ domain: "contoh.com" }] })));
  const tools = inventoryTools(createApiClient({ apiUrl: "http://127.0.0.1:3000", apiKey: "k", fetch: fetchMock }));
  const result = await tool(tools, "list_websites").handler({ domain: "contoh" });
  expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:3000/v1/websites?domain=contoh");
  expect(JSON.parse(result.content[0].text).websites[0].domain).toBe("contoh.com");
});
test("API down becomes a readable tool error", async () => {
  const tools = inventoryTools(createApiClient({ apiUrl: "http://127.0.0.1:3000", apiKey: "k", fetch: async () => { throw new TypeError("fetch failed"); } }));
  const result = await tool(tools, "list_logins").handler({});
  expect(result).toEqual({ isError: true, content: [{ type: "text", text: "Hostinger Ops API is not running. Start it with: pnpm dev:api" }] });
});
test.each([[401, "Hostinger Ops API rejected the internal key"], [500, "Hostinger Ops API error (500)"]])("status %i becomes a tool error", async (status, text) => {
  const tools = inventoryTools(createApiClient({ apiUrl: "http://x", apiKey: "k", fetch: async () => new Response("{}", { status }) }));
  expect((await tool(tools, "list_logins").handler({})).content[0].text).toBe(text);
});
test("get_login_capabilities requires a login", () => {
  expect(tool(tools, "get_login_capabilities").inputSchema.safeParse({}).success).toBe(false);
});
```

- [ ] **Step 3:** Jalankan → FAIL.
- [ ] **Step 4:** Implementasikan. `index.ts` membaca `.env` di root repo (dicari relatif terhadap lokasi file, bukan `cwd`), mendaftarkan tool, memakai transport stdio, dan menulis log hanya ke stderr.
- [ ] **Step 5:** `.mcp.json`: server `hostinger-ops`, `command: "node"`, `args: ["./apps/mcp-server/dist/index.js"]`. Tanpa rahasia di file ini.
- [ ] **Step 6:** Jalankan → PASS. `corepack pnpm build`, lalu uji asap: kirim pesan `initialize` dan `tools/list` lewat stdin ke `node apps/mcp-server/dist/index.js`; stdout hanya berisi JSON-RPC dan memuat keempat nama tool.
- [ ] **Step 7:** Commit `Add MCP server with read-only inventory tools`.

### Task 6: Verifikasi akhir M1

- [ ] **Step 1:** Dari keadaan bersih: `corepack pnpm infra:up` → `ops-postgres` `healthy`.
- [ ] **Step 2:** `corepack pnpm db:migrate && corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` → semua exit 0.
- [ ] **Step 3:** `git log --format=%B | grep -Ei "co-authored|generated with"` → kosong. `git ls-files | grep -E "^\.env$"` → kosong.
- [ ] **Step 4:** Minta pemilik membuka ulang Claude Code di folder ini dan menjalankan `/mcp`; `hostinger-ops` harus tersambung. Ini satu-satunya butir DoD yang tidak bisa diperiksa agent sendiri.
- [ ] **Step 5:** Tulis `docs/ARCHITECTURE.md` dan `docs/SECURITY.md` singkat (isi: diagram alur MCP → API → DB; risiko yang diterima dari PRD §8.3). Commit `Document architecture and accepted security limits`.

## Di luar rencana ini

Worker, antrean PostgreSQL, `hostinger-adapter`, `ssh-adapter`, perintah `ops:*`, dan kelima `SKILL.md` dibuat di rencana M2–M5, ketika ada kode yang memakainya.
