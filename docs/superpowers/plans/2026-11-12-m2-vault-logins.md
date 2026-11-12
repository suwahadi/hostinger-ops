# M2 Vault, Login & Uji Koneksi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pemilik bisa menyimpan token Hostinger terenkripsi dari terminalnya sendiri, mendaftarkan login dengan nama samaran, dan Claude bisa menguji koneksi tiap login secara baca-saja lalu melihat status dan daftar kemampuannya.

**Architecture:** Paket baru `@ops/hostinger-adapter` berisi pembatas laju, HTTP client Hostinger, penyedia token dari vault, dan daftar uji kemampuan. `apps/api` mendapat layanan rahasia, login, dan verifikasi, dua perintah CLI untuk manusia, serta route `POST /v1/logins/:alias/verify`. MCP mendapat tool `verify_login_connection`. Token hanya didekripsi di proses API.

**Tech Stack:** Sama dengan M1. Tidak ada dependensi baru.

**Spec:** `PRD.md` §3.2, §4, §7.1, §8.1, §8.4, §11, §12 M2. Aturan repo: `AGENT.md`. Rencana sebelumnya: `docs/superpowers/plans/2026-11-11-m1-foundation.md`.

## Global Constraints

- Pakai `corepack pnpm ...` (pnpm tidak ada di PATH). Sebelum commit: `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` lolos (AGENT.md §3).
- Hostinger: base URL `https://developers.hostinger.com`, header `Authorization: Bearer <token>`, `Accept: application/json`, `User-Agent: hostinger-ops`. Batas waktu 30 detik per request. Maksimal 90 request per 60 detik **per login**. 429 → tunggu `Retry-After` lalu ulangi.
- Uji kemampuan **hanya GET**. Tidak ada request yang mengubah apa pun di Hostinger.
- Token, nilai rahasia, dan isi `.env` tidak boleh muncul di respons API, `AuditLog`, log, pesan error, test fixture yang di-commit, atau output CLI (PRD §4.1).
- Nilai rahasia hanya masuk lewat prompt tersembunyi di terminal interaktif; tidak pernah sebagai argumen perintah (PRD §8.1).
- Fallback token dari `process.env[tokenRef]` hanya bila `NODE_ENV === "development"` (PRD §14 butir 10).
- Tidak ada identitas hosting sungguhan di kode, test, dokumen, atau commit; pakai `sumber`, `tujuan`, `contoh.com` (AGENT.md §2).
- Tidak ada perubahan skema database. Nilai `HostingerLogin.status`: `UNVERIFIED`, `CONNECTED`, `DEGRADED`, `TOKEN_INVALID`, `NO_TOKEN`, `SECRET_UNREADABLE`.
- Komentar dan pesan commit mengikuti AGENT.md §1 dan §4.

## Review Focus

1. Token ditempel dengan spasi atau baris baru di ujung → disimpan setelah di-trim; input kosong ditolak. Test di Task 2.
2. Hostinger membalas 429 tanpa `Retry-After` atau dengan format tanggal → menunggu 60 detik (batas atas 60 detik), lalu mengulang; tidak crash. Test di Task 1.
3. Token salah atau sudah dicabut → status login `TOKEN_INVALID`, kemampuan `available: false` dengan catatan `token rejected`, respons 200, bukan 500. Test di Task 4.
4. `ops:secret:set` atau `ops:login:add` dijalankan tanpa terminal interaktif (di-pipe, atau lewat `!` di Claude Code) → menolak dengan pesan jelas dan tidak menyimpan apa pun. Test di Task 2.
5. `SECRETS_MASTER_KEY` di `.env` diganti setelah token disimpan → dekripsi gagal → status `SECRET_UNREADABLE` dengan pesan yang bisa ditindaklanjuti, bukan 500. Test di Task 4.

---

### Task 1: Pembatas laju dan HTTP client Hostinger

**Files:**
- Create: `packages/hostinger-adapter/package.json` (`@ops/hostinger-adapter`, dependensi `@ops/database`, `@ops/shared`), `packages/hostinger-adapter/tsconfig.json` (references ke keduanya), `packages/hostinger-adapter/src/index.ts`, `packages/hostinger-adapter/src/rate-limiter.ts`, `packages/hostinger-adapter/src/client.ts`
- Modify: `tsconfig.json` (tambah reference)
- Test: `packages/hostinger-adapter/src/rate-limiter.test.ts`, `packages/hostinger-adapter/src/client.test.ts`

**Interfaces:**
- Produces:
  - `type Sleep = (ms: number) => Promise<void>`
  - `createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number; sleep?: Sleep }): RateLimiter`, `type RateLimiter = { acquire(key: string): Promise<void> }` — jendela geser per `key`.
  - `type HostingerResult = { status: number | null; error: "timeout" | "network_error" | null; body: unknown }` (`status` null hanya bila `error` terisi).
  - `type HostingerCall = { method: "GET"; path: string; status: number | null; error: HostingerResult["error"]; attempt: number; durationMs: number }`
  - `createHostingerClient(opts: { token: string; limiterKey: string; limiter: RateLimiter; fetch?: typeof fetch; sleep?: Sleep; onCall?: (call: HostingerCall) => Promise<void> }): HostingerClient`, `type HostingerClient = { get(path: string, query?: Record<string, string | number>): Promise<HostingerResult> }`
  - Konstanta `HOSTINGER_BASE_URL = "https://developers.hostinger.com"`, `HOSTINGER_RATE_LIMIT = { limit: 90, windowMs: 60_000 }`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// rate-limiter.test.ts — jam palsu: sleep memajukan waktu
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}
test("lets 90 calls through, then waits until the oldest leaves the window", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ limit: 90, windowMs: 60_000, ...clock });
  for (let i = 0; i < 90; i++) await limiter.acquire("login-a");
  expect(clock.now()).toBe(0);
  await limiter.acquire("login-a");
  expect(clock.now()).toBe(60_000);
});
test("keeps a separate budget per key", async () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, ...clock });
  await limiter.acquire("a");
  await limiter.acquire("b");
  expect(clock.now()).toBe(0);
});

// client.test.ts
const token = "tok-rahasia-123";
const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("sends the bearer token to the Hostinger base URL with query params", async () => {
  const fetchMock = vi.fn(async () => json(200, { data: [] }));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock });
  const result = await client.get("/api/hosting/v1/websites", { per_page: 1 });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://developers.hostinger.com/api/hosting/v1/websites?per_page=1");
  expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${token}`);
  expect(result).toEqual({ status: 200, error: null, body: { data: [] } });
});
test.each([
  [{ "retry-after": "2" }, 2_000],
  [{}, 60_000],
  [{ "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }, 60_000],
  [{ "retry-after": "600" }, 60_000],
])("429 with %o waits %i ms and retries", async (headers, waited) => {
  const sleep = vi.fn(async () => {});
  const fetchMock = vi.fn().mockResolvedValueOnce(json(429, {}, headers)).mockResolvedValueOnce(json(200));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock, sleep });
  expect((await client.get("/x")).status).toBe(200);
  expect(sleep).toHaveBeenCalledWith(waited);
});
test("gives up after 3 attempts of 429", async () => {
  const fetchMock = vi.fn(async () => json(429, {}, { "retry-after": "1" }));
  const client = createHostingerClient({ token, limiterKey: "a", limiter: noLimit, fetch: fetchMock, sleep: async () => {} });
  expect((await client.get("/x")).status).toBe(429);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
test.each([
  [Object.assign(new Error("t"), { name: "TimeoutError" }), "timeout"],
  [new TypeError(`fetch failed for Bearer ${token}`), "network_error"],
])("maps a thrown fetch error to %s without echoing it", async (thrown, kind) => {
  const calls: HostingerCall[] = [];
  const client = createHostingerClient({
    token, limiterKey: "a", limiter: noLimit, fetch: async () => { throw thrown; }, onCall: async (c) => { calls.push(c); },
  });
  expect(await client.get("/x")).toEqual({ status: null, error: kind, body: null });
  expect(JSON.stringify(calls)).not.toContain(token);
});
test("reports every attempt to onCall without the token", async () => {
  const calls: HostingerCall[] = [];
  const fetchMock = vi.fn().mockResolvedValueOnce(json(429, {}, { "retry-after": "1" })).mockResolvedValueOnce(json(200));
  const client = createHostingerClient({
    token, limiterKey: "a", limiter: noLimit, fetch: fetchMock, sleep: async () => {}, onCall: async (c) => { calls.push(c); },
  });
  await client.get("/api/hosting/v1/orders", { per_page: 1 });
  expect(calls.map((c) => [c.path, c.status, c.attempt])).toEqual([["/api/hosting/v1/orders", 429, 1], ["/api/hosting/v1/orders", 200, 2]]);
});
test("acquires the limiter with the login key before each attempt", async () => {
  const acquire = vi.fn(async () => {});
  const client = createHostingerClient({ token, limiterKey: "login-a", limiter: { acquire }, fetch: async () => json(200) });
  await client.get("/x");
  expect(acquire).toHaveBeenCalledWith("login-a");
});
```

`noLimit` = `{ acquire: async () => {} }`, didefinisikan di file test.

- [ ] **Step 2:** `corepack pnpm vitest run packages/hostinger-adapter` → FAIL (modul belum ada).
- [ ] **Step 3:** Implementasikan. Client: `AbortSignal.timeout(30_000)`; body dibaca dengan `response.json().catch(() => null)`; `Retry-After` hanya diterima sebagai bilangan bulat detik, dibatasi `Math.min(detik, 60) * 1000`, selain itu 60 000 ms; maksimal 3 percobaan. `path` di `HostingerCall` tanpa query string. Limiter: simpan timestamp per key; bila penuh, `sleep(oldest + windowMs - now)` lalu cek ulang. Beri komentar `shortcut:` di limiter: anggaran hanya dibagi di dalam satu proses; pindah ke penyimpanan bersama saat worker ikut memanggil Hostinger (M3).
- [ ] **Step 4:** Jalankan → PASS. `corepack pnpm typecheck` lolos.
- [ ] **Step 5:** Commit `Add Hostinger HTTP client with per-login rate limiting`.

### Task 2: Vault, login, dan perintah CLI

**Files:**
- Create: `packages/hostinger-adapter/src/token-provider.ts`, `apps/api/src/env-file.ts`, `apps/api/src/services/secrets.ts`, `apps/api/src/services/logins.ts`, `apps/api/src/cli/prompt.ts`, `apps/api/src/cli/secret-set.ts`, `apps/api/src/cli/login-add.ts`
- Modify: `apps/api/src/server.ts` (pakai `loadRootEnv`), `apps/api/package.json` (dependensi `@ops/hostinger-adapter`), `apps/api/tsconfig.json` (reference), `package.json` root (skrip), `.claude/settings.json` (aturan deny)
- Test: `packages/hostinger-adapter/src/token-provider.test.ts`, `apps/api/src/services/secrets.test.ts`, `apps/api/src/cli/prompt.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret`, `parseMasterKey` (`@ops/shared`); `createTestDb`, `PrismaClient` (`@ops/database`).
- Produces:
  - `createTokenProvider(opts: { db: PrismaClient; masterKey: Buffer; env?: NodeJS.ProcessEnv }): TokenProvider`, `type TokenProvider = { getToken(tokenRef: string): Promise<string> }` — memperbarui `SecretVault.lastUsedAt`.
  - `class TokenUnavailableError extends Error { reason: "missing" | "unreadable" }` dengan pesan `No secret stored for <tokenRef>` / `Secret <tokenRef> cannot be decrypted with the current SECRETS_MASTER_KEY`.
  - `storeSecret(db: PrismaClient, masterKey: Buffer, input: { refKey: string; value: string }): Promise<"created" | "rotated">` — `refKey` harus cocok `/^[A-Z][A-Z0-9_]{2,63}$/`; `value` di-trim, kosong ditolak (`Error("Secret value is empty")`); kategori `API_TOKEN`; rotasi mengisi `rotatedAt`; menulis `AuditLog` (`actor: CLI_HUMAN`, `action: SECRET_SET`, `resource: secret_vault`, `resourceId: refKey`, `result: created|rotated`).
  - `hasSecret(db: PrismaClient, refKey: string): Promise<boolean>`
  - `addLogin(db: PrismaClient, input: { alias: string; tokenRef: string }): Promise<void>` — alias harus cocok `/^[a-z0-9][a-z0-9-]{0,31}$/` (`Error("Alias must be lowercase letters, digits, or dashes")`); alias ganda → `Error('Login "<alias>" already exists')`; audit `LOGIN_ADD`.
  - `defaultTokenRef(alias: string): string` → `HOSTINGER_TOKEN_` + alias huruf besar, `-` diganti `_`.
  - `assertInteractive(stream: { isTTY?: boolean }): void` → `Error("Run this command in your own terminal: the secret must be typed, not piped")`.
  - `readHidden(question: string): Promise<string>` — mode raw, tanpa echo, Enter mengakhiri, Ctrl+C membatalkan.
  - `loadRootEnv(): void` di `apps/api/src/env-file.ts` (dipindah dari `server.ts`).
  - Skrip root: `"ops:secret:set": "node apps/api/dist/cli/secret-set.js"`, `"ops:login:add": "node apps/api/dist/cli/login-add.js"`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// token-provider.test.ts
const key = parseMasterKey("ab".repeat(32));
test("decrypts a stored token and stamps lastUsedAt", async () => {
  await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret("tok-1", key) } });
  expect(await createTokenProvider({ db, masterKey: key, env: {} }).getToken("HOSTINGER_TOKEN_SUMBER")).toBe("tok-1");
  expect((await db.secretVault.findUnique({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } }))?.lastUsedAt).not.toBeNull();
});
test("falls back to env only in development", async () => {
  const env = { HOSTINGER_TOKEN_TUJUAN: "tok-env" };
  expect(await createTokenProvider({ db, masterKey: key, env: { ...env, NODE_ENV: "development" } }).getToken("HOSTINGER_TOKEN_TUJUAN")).toBe("tok-env");
  await expect(createTokenProvider({ db, masterKey: key, env: { ...env, NODE_ENV: "production" } }).getToken("HOSTINGER_TOKEN_TUJUAN"))
    .rejects.toMatchObject({ reason: "missing", message: "No secret stored for HOSTINGER_TOKEN_TUJUAN" });
});
test("reports a secret encrypted with another master key as unreadable", async () => {
  await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_LAMA", ...encryptSecret("tok-2", parseMasterKey("cd".repeat(32))) } });
  await expect(createTokenProvider({ db, masterKey: key, env: {} }).getToken("HOSTINGER_TOKEN_LAMA")).rejects.toMatchObject({ reason: "unreadable" });
});

// secrets.test.ts
test("stores a trimmed value encrypted and audits without the value", async () => {
  expect(await storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "  tok-abc \r\n" })).toBe("created");
  const row = await db.secretVault.findUniqueOrThrow({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } });
  expect(row.cipherText).not.toContain("tok-abc");
  expect(decryptSecret(row, key)).toBe("tok-abc");
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("tok-abc");
});
test("second store rotates the secret", async () => {
  expect(await storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "tok-new" })).toBe("rotated");
  expect((await db.secretVault.findUniqueOrThrow({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } })).rotatedAt).not.toBeNull();
});
test.each([["", "Secret value is empty"], ["   \n", "Secret value is empty"]])("rejects value %j", async (value, message) => {
  await expect(storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_X", value })).rejects.toThrow(message);
});
test("rejects a malformed refKey", async () => {
  await expect(storeSecret(db, key, { refKey: "bad key", value: "x" })).rejects.toThrow();
});
test("adds a login, refuses a duplicate or malformed alias", async () => {
  await addLogin(db, { alias: "sumber", tokenRef: defaultTokenRef("sumber") });
  expect((await db.hostingerLogin.findUniqueOrThrow({ where: { alias: "sumber" } })).tokenRef).toBe("HOSTINGER_TOKEN_SUMBER");
  await expect(addLogin(db, { alias: "sumber", tokenRef: "X" })).rejects.toThrow('Login "sumber" already exists');
  await expect(addLogin(db, { alias: "Sumber Utama", tokenRef: "X" })).rejects.toThrow("Alias must be lowercase letters, digits, or dashes");
});
test("defaultTokenRef turns dashes into underscores", () => {
  expect(defaultTokenRef("akun-dua")).toBe("HOSTINGER_TOKEN_AKUN_DUA");
});

// prompt.test.ts
test.each([[{ isTTY: false }], [{}]])("refuses a non-interactive stdin %o", (stream) => {
  expect(() => assertInteractive(stream)).toThrow("Run this command in your own terminal: the secret must be typed, not piped");
});
test("accepts a TTY", () => {
  expect(() => assertInteractive({ isTTY: true })).not.toThrow();
});
```

- [ ] **Step 2:** Jalankan ketiga file test → FAIL.
- [ ] **Step 3:** Implementasikan layanan dan `token-provider.ts`. Ekspor `createTokenProvider`, `TokenUnavailableError` dari `@ops/hostinger-adapter`.
- [ ] **Step 4:** Tulis kedua CLI. Urutan `secret-set.js <refKey>`: `loadRootEnv` → `assertInteractive(process.stdin)` → `readHidden("Value for <refKey>: ")` → `storeSecret` → cetak `Stored <refKey> (created|rotated)`. Urutan `login-add.js <alias> [--token-ref <REF>]`: validasi alias → bila `hasSecret` false, `assertInteractive` lalu `readHidden("Hostinger API token for <alias>: ")` dan `storeSecret` → `addLogin` → cetak `Login <alias> added. Ask Claude to run verify_login_connection for <alias>.` Kesalahan dicetak ke stderr sebagai satu baris pesan (tanpa stack), exit 1. Kedua CLI memutus koneksi Prisma sebelum keluar.
- [ ] **Step 5:** Tambah ke `permissions.deny` di `.claude/settings.json`: `Bash(pnpm ops:login:add *)`, `Bash(corepack pnpm ops:login:add *)`, `Bash(node apps/api/dist/cli/*)`.
- [ ] **Step 6:** Jalankan → PASS. Uji manual non-interaktif: `echo x | node apps/api/dist/cli/secret-set.js HOSTINGER_TOKEN_UJI` (setelah `corepack pnpm build`) → exit 1 dengan pesan "Run this command in your own terminal…", dan `HOSTINGER_TOKEN_UJI` tidak ada di `secret_vaults`.
- [ ] **Step 7:** Commit `Add secret vault and login CLI commands`.

### Task 3: Daftar uji kemampuan

**Files:**
- Create: `packages/hostinger-adapter/src/capabilities.ts`
- Test: `packages/hostinger-adapter/src/capabilities.test.ts`

**Interfaces:**
- Consumes: `HostingerClient`, `HostingerResult` (Task 1).
- Produces: `type ProbeResult = { name: string; available: boolean; httpStatus: number | null; note: string | null }`, `probeCapabilities(client: HostingerClient): Promise<ProbeResult[]>` — berurutan, satu request per probe:

| `name` | Request |
| :--- | :--- |
| `hosting.orders.list` | `GET /api/hosting/v1/orders?per_page=1` |
| `hosting.websites.list` | `GET /api/hosting/v1/websites?per_page=1` |
| `domains.portfolio.list` | `GET /api/domains/v1/portfolio` |
| `dns.zone.read` | `GET /api/dns/v1/zones/<domain>` memakai item pertama dari portfolio (`body[0].domain`); bila tidak ada, tanpa request: `available: false, httpStatus: null, note: "no domain in portfolio to probe"` |

`available` = status 200. `note`: 401 → `token rejected`, 403 → `not permitted for this token`, 404 → `not found`, 429 → `rate limited`, `timeout` → `timed out after 30s`, `network_error` → `network error`, status lain bukan 200 → `HTTP <status>`, 200 → `null`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
function fakeClient(byPath: Record<string, HostingerResult>) {
  const paths: string[] = [];
  const client: HostingerClient = {
    get: async (path) => { paths.push(path); return byPath[path] ?? { status: 404, error: null, body: null }; },
  };
  return { client, paths };
}
const ok = (body: unknown = {}) => ({ status: 200, error: null, body });

test("probes the four read-only endpoints and uses the first portfolio domain for DNS", async () => {
  const { client, paths } = fakeClient({
    "/api/hosting/v1/orders": ok(), "/api/hosting/v1/websites": ok(),
    "/api/domains/v1/portfolio": ok([{ domain: "contoh.com" }]), "/api/dns/v1/zones/contoh.com": ok([]),
  });
  const results = await probeCapabilities(client);
  expect(paths).toEqual(["/api/hosting/v1/orders", "/api/hosting/v1/websites", "/api/domains/v1/portfolio", "/api/dns/v1/zones/contoh.com"]);
  expect(results.every((r) => r.available && r.note === null)).toBe(true);
});
test("skips the DNS probe when the portfolio is empty", async () => {
  const { client, paths } = fakeClient({ "/api/domains/v1/portfolio": ok([]) });
  expect((await probeCapabilities(client)).find((r) => r.name === "dns.zone.read")).toEqual({
    name: "dns.zone.read", available: false, httpStatus: null, note: "no domain in portfolio to probe",
  });
  expect(paths).not.toContain("/api/dns/v1/zones/undefined");
});
test.each([
  [{ status: 401, error: null, body: null }, 401, "token rejected"],
  [{ status: 403, error: null, body: null }, 403, "not permitted for this token"],
  [{ status: 500, error: null, body: null }, 500, "HTTP 500"],
  [{ status: null, error: "timeout", body: null }, null, "timed out after 30s"],
])("maps %o to a note", async (result, httpStatus, note) => {
  const { client } = fakeClient({ "/api/hosting/v1/orders": result as HostingerResult });
  expect((await probeCapabilities(client))[0]).toEqual({ name: "hosting.orders.list", available: false, httpStatus, note });
});
```

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan. Domain dari portfolio di-`encodeURIComponent` sebelum masuk path. Ekspor dari `index.ts`.
- [ ] **Step 4:** Jalankan → PASS.
- [ ] **Step 5:** Commit `Add read-only capability probes`.

### Task 4: Verifikasi login lewat API, dengan audit

**Files:**
- Create: `apps/api/src/services/verify-login.ts`
- Modify: `apps/api/src/app.ts` (deps baru, `genReqId`), `apps/api/src/routes/inventory.ts` (route verify), `apps/api/src/server.ts` (oper `masterKey`), `apps/api/src/app.test.ts` (oper `masterKey`)
- Test: `apps/api/src/services/verify-login.test.ts`, tambahan di `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: Task 1–3; `LoginSummary`, `CapabilitySummary` (`@ops/shared`).
- Produces:
  - `AppDeps` menjadi `{ db: PrismaClient; apiKey: string; masterKey: Buffer; logger?: boolean; fetch?: typeof fetch; limiter?: RateLimiter; sleep?: Sleep }`. `buildApp` membuat satu limiter `HOSTINGER_RATE_LIMIT` bila tidak diberikan, dan memakai `genReqId: () => randomUUID()`.
  - `verifyLogin(deps: { db: PrismaClient; masterKey: Buffer; limiter: RateLimiter; fetch?: typeof fetch; sleep?: Sleep; requestId: string }, alias: string): Promise<{ login: LoginSummary; capabilities: CapabilitySummary[] } | null>` — `null` bila alias tidak dikenal.
  - Route `POST /v1/logins/:alias/verify` → 200 hasil `verifyLogin`, atau 404 `{ "error": "login_not_found" }`.
- Aturan status login: token tidak ada → `NO_TOKEN`; tidak bisa didekripsi → `SECRET_UNREADABLE`; ada probe berstatus 401 → `TOKEN_INVALID`; `hosting.websites.list` tersedia → `CONNECTED`; selain itu `DEGRADED`. Pada `NO_TOKEN` dan `SECRET_UNREADABLE` tidak ada request ke Hostinger dan kemampuan lama dibiarkan. Selain itu, hasil probe di-upsert ke `HostingCapability` per (`loginId`, `name`) dengan `checkedAt` sekarang. `lastVerifiedAt` diisi pada setiap verifikasi.
- Audit: setiap `HostingerCall` → baris `actor: CLAUDE_MCP`, `action: HOSTINGER_API_CALL`, `resource: hostinger_login`, `resourceId: <alias>`, `result: <status atau error>`, `detail: { path, attempt, durationMs }`. Satu baris penutup `action: LOGIN_VERIFY`, `result: <status login>`. Semua memakai `requestId` yang sama.

- [ ] **Step 1: Tulis test yang gagal** (`verify-login.test.ts`, memakai `createTestDb`, `fetch` palsu yang menjawab per path, limiter tanpa batas)

```ts
const token = "tok-rahasia-123";
test("connected login: upserts four capabilities and audits every call without the token", async () => {
  await seedLogin("sumber", token);           // addLogin + storeSecret dari Task 2
  const result = await verifyLogin(deps(fetchAll200WithPortfolio("contoh.com")), "sumber");
  expect(result?.login).toMatchObject({ alias: "sumber", status: "CONNECTED", lastVerifiedAt: expect.any(String) });
  expect(result?.capabilities.map((c) => c.name).sort()).toEqual(["dns.zone.read", "domains.portfolio.list", "hosting.orders.list", "hosting.websites.list"]);
  const audit = await db.auditLog.findMany({ where: { requestId: "req-1" } });
  expect(audit.filter((a) => a.action === "HOSTINGER_API_CALL")).toHaveLength(4);
  expect(audit.find((a) => a.action === "LOGIN_VERIFY")?.result).toBe("CONNECTED");
  expect(JSON.stringify({ result, audit })).not.toContain(token);
});
test("a second verify updates capabilities instead of duplicating them", async () => {
  await verifyLogin(deps(fetchAll200WithPortfolio("contoh.com")), "sumber");
  expect(await db.hostingCapability.count()).toBe(4);
});
test("rejected token marks the login TOKEN_INVALID", async () => {
  const result = await verifyLogin(deps(fetchAlways(401)), "sumber");
  expect(result?.login.status).toBe("TOKEN_INVALID");
  expect(result?.capabilities.find((c) => c.name === "hosting.websites.list")).toMatchObject({ available: false, note: "token rejected" });
});
test("missing secret marks NO_TOKEN and calls nothing", async () => {
  await addLogin(db, { alias: "tujuan", tokenRef: "HOSTINGER_TOKEN_TUJUAN" });
  const fetchMock = vi.fn();
  expect((await verifyLogin(deps(fetchMock), "tujuan"))?.login.status).toBe("NO_TOKEN");
  expect(fetchMock).not.toHaveBeenCalled();
});
test("secret under another master key marks SECRET_UNREADABLE", async () => {
  await addLogin(db, { alias: "lama", tokenRef: "HOSTINGER_TOKEN_LAMA" });
  await storeSecret(db, parseMasterKey("cd".repeat(32)), { refKey: "HOSTINGER_TOKEN_LAMA", value: "tok" });
  expect((await verifyLogin(deps(vi.fn()), "lama"))?.login.status).toBe("SECRET_UNREADABLE");
});
test("unknown alias returns null", async () => {
  expect(await verifyLogin(deps(vi.fn()), "tidak-ada")).toBeNull();
});
```

Helper lokal di file test: `deps(fetch)` mengembalikan `{ db, masterKey: key, limiter: { acquire: async () => {} }, sleep: async () => {}, fetch, requestId: "req-1" }`; `seedLogin(alias, token)` memanggil `addLogin` dan `storeSecret`; `fetchAll200WithPortfolio(domain)` menjawab 200 untuk semua path dan `[{ domain }]` untuk `/api/domains/v1/portfolio`; `fetchAlways(status)` menjawab status itu untuk semua path.

Di `app.test.ts`: `buildApp` menerima `masterKey` dan `fetch`; tambah test `POST /v1/logins/sumber/verify` → 200 dengan `login.status` dan `capabilities`; `POST /v1/logins/tidak-ada/verify` → 404 `login_not_found`; tanpa kunci → 401.

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan `verifyLogin`, route, dan perubahan `AppDeps`. Perbarui `server.ts` dan test M1 yang memanggil `buildApp`.
- [ ] **Step 4:** Jalankan seluruh suite → PASS.
- [ ] **Step 5:** Commit `Add login verification endpoint with audit trail`.

### Task 5: Tool MCP `verify_login_connection`

**Files:**
- Modify: `apps/mcp-server/src/client.ts`, `apps/mcp-server/src/tools/inventory.ts`
- Test: `apps/mcp-server/src/tools/inventory.test.ts`

**Interfaces:**
- Consumes: route Task 4.
- Produces: `ApiClient` mendapat `post(path: string, opts?: { timeoutMs?: number }): Promise<unknown>`; pesan batas waktu menjadi `Hostinger Ops API did not respond within <n> seconds`. Tool `verify_login_connection` (`login: string`, wajib) → `POST /v1/logins/<alias ter-encode>/verify` dengan batas waktu 180 detik.

- [ ] **Step 1: Tulis test yang gagal**

```ts
test("verify_login_connection posts to the verify route", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ login: { alias: "sumber", status: "CONNECTED" } })));
  const result = await tool(toolsWith(fetchMock), "verify_login_connection").handler({ login: "sumber" });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe("http://127.0.0.1:3000/v1/logins/sumber/verify");
  expect(init.method).toBe("POST");
  expect(JSON.parse(result.content[0]!.text).login.status).toBe("CONNECTED");
});
test("verify_login_connection requires a login", () => {
  expect(tool(toolsWith(fetch), "verify_login_connection").inputSchema.safeParse({}).success).toBe(false);
});
```

Perbarui test "registers the four read-only tools" menjadi lima nama, termasuk `verify_login_connection`.

- [ ] **Step 2:** Jalankan → FAIL.
- [ ] **Step 3:** Implementasikan; `get` dan `post` berbagi satu fungsi request. Deskripsi tool menyebut bahwa ia hanya membaca dari Hostinger dan memperbarui status kemampuan di database lokal.
- [ ] **Step 4:** Jalankan → PASS; `corepack pnpm build`.
- [ ] **Step 5:** Commit `Add verify_login_connection MCP tool`.

### Task 6: Uji pilot dengan dua login sungguhan

Langkah ini butuh pemilik; agent tidak pernah memegang tokennya.

- [ ] **Step 1:** Agent: `corepack pnpm build`. Minta pemilik membuka **terminal terpisah** (PowerShell, bukan `!` di Claude Code) di folder repo dan menjalankan, untuk dua login pilot dengan nama samaran pilihannya:
  `corepack pnpm ops:login:add <alias>` → ketik token saat diminta.
- [ ] **Step 2:** Pemilik menjalankan `corepack pnpm dev:api` dan `/mcp` (reconnect) di Claude Code.
- [ ] **Step 3:** Agent memanggil `verify_login_connection` untuk kedua alias, lalu `list_logins` dan `get_login_capabilities`. Harapan: status `CONNECTED` (atau status lain dengan catatan yang menjelaskan sebabnya).
- [ ] **Step 4:** Agent memeriksa tanpa membaca nilai rahasia: `secret_vaults` berisi dua baris dengan `cipherText` (bukan plaintext — cocokkan panjang dan pola base64 saja); jumlah baris `audit_logs` dengan `action = 'HOSTINGER_API_CALL'` sama dengan jumlah panggilan; `SELECT count(*) FROM audit_logs WHERE detail::text ILIKE '%bearer%'` = 0.
- [ ] **Step 5:** Tulis hasil kemampuan per login (tanpa alias asli bila pemilik tidak mau; tanpa domain) ke `docs/API-CAPABILITIES.md`; perbarui `docs/ARCHITECTURE.md`, `docs/SECURITY.md` (CLI menolak input non-interaktif), dan `MEMORY.md`. Commit `Record pilot capability results`.

## Di luar rencana ini

Sinkronisasi inventaris (paket dan website), worker dan antrean: M3. Perintah `ops:approve`/`ops:reject`: M4c. Impor CSV massal: M8.
