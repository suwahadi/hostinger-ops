# Arsitektur (keadaan M3 + tampilan web)

```text
Claude Code ──stdio──▶ apps/mcp-server ──HTTP + x-api-key──▶ apps/api (+ worker) ──Prisma──▶ PostgreSQL 17 (Docker)
                        8 tool               127.0.0.1:3000        │                       127.0.0.1:${OPS_PG_PORT}
Browser pemilik ──HTTP + cookie sesi─────────▶ (halaman web) ──────┤
                                                                   ├──HTTPS + Bearer──▶ developers.hostinger.com
                                                                   └──HTTPS, nama domain saja──▶ RDAP registry (via bootstrap IANA)
Terminal pemilik ──ops:secret:set / ops:login:add / ops:ui:password──▶ apps/api/dist/cli ──▶ PostgreSQL
```

**Dua pintu di satu port.** Hook `onRequest` di `apps/api/src/app.ts` memilih pintu dari route yang dicocokkan router (`request.routeOptions.url`), bukan dari URL mentah:
- `/v1/*` hanya terbuka dengan `x-api-key` (jalur Claude); cookie diabaikan.
- Halaman web hanya terbuka dengan sesi browser; `x-api-key` diabaikan.
- `/health`, `/login`, `/assets/*` (CSS dan skrip kecil), dan `/favicon.ico` publik.

**Tampilan web** (`apps/api/src/web/`): Ringkasan, Paket, Website (+ detail), dan Sinkron & Audit, dirender di server; satu skrip kecil hanya untuk loader dan tombol Kembali. Tombol yang hanya membaca: Sinkronkan, Uji koneksi, Cek tanggal kedaluwarsa (per website, langsung), dan Cek semua yang belum diketahui (job `check-domain-expiry` di worker). Pengecek kedaluwarsa ada di `apps/worker/src/processors/domain-expiry.ts`: Hostinger dulu, lalu RDAP (`apps/worker/src/rdap.ts`). Angka di Ringkasan dan `/v1/capacity` memakai satu aturan hitung di `services/inventory-report.ts`: paket dan website `UNKNOWN` tidak dihitung, dan website dihitung dari barisnya.

## Membuka tampilan web

```powershell
corepack pnpm build
corepack pnpm ops:ui:password   # sekali; di terminal sendiri, minimal 12 karakter
corepack pnpm dev:api           # biarkan berjalan
```

Lalu buka `http://127.0.0.1:3000/` (atau `http://localhost:3000/`). Sesi berakhir setelah 8 jam tidak aktif, saat API dinyalakan ulang, atau saat password diganti.

**Satu proses.** `corepack pnpm dev:api` menjalankan API dan loop worker sekaligus (keputusan pemilik, 12 Nov 2026). Akibatnya satu pembatas laju 90/menit per login berlaku untuk semua panggilan Hostinger. Antrean disimpan di tabel `jobs` PostgreSQL: job yang terputus karena PC tidur atau restart kembali ke `QUEUED` saat API menyala lagi.

**Paket bisa dimiliki satu login dan diakses banyak login.** `hosting_account_access` mencatat setiap login yang bisa melihat sebuah paket. `hosting_accounts.loginId` adalah pemiliknya:
- login yang daftar billing-nya memuat langganan paket itu (`ownerSource: BILLING`);
- bila tidak ada, login pertama yang melihatnya (`FIRST_SEEN`).

Sebuah paket baru menjadi `UNKNOWN` bila tidak ada lagi login yang bisa melihatnya. Ini menyimpang dari PRD §7.1 (satu paket, satu login) setelah uji pilot menemukan paket bersama.

| Bagian | Isi |
| :--- | :--- |
| `packages/shared` | AES-256-GCM (`encryptSecret`, `decryptSecret`, `parseMasterKey`) dan skema Zod respons API |
| `packages/database` | Skema Prisma lengkap (PRD §7.1), migrasi, `createDb`, `createTestDb` |
| `packages/hostinger-adapter` | Client Hostinger dengan pembatas 90/menit per login dan penanganan 429, penyedia token dari vault, 4 probe baca-saja, paginasi (`getAllPages`, `getList`) |
| `apps/worker` | Antrean `jobs` (dedupe, retry, pemulihan job terputus), loop worker, prosesor `sync-login` |
| `apps/api` | Fastify + worker. `/health` tanpa kunci; dengan kunci internal: `/v1/logins`, `/v1/accounts`, `/v1/websites`, `/v1/websites/:domain`, `/v1/capacity`, `/v1/logins/:alias/capabilities`, `POST /v1/logins/:alias/verify`, `POST /v1/sync`. Halaman web di `src/web`, CLI pemilik di `src/cli` |
| `apps/mcp-server` | `list_logins`, `list_accounts`, `list_websites`, `get_login_capabilities`, `verify_login_connection`, `trigger_inventory_sync`, `get_website_details`, `get_capacity_report`; hanya memanggil API lokal |

Belum ada: adapter SSH, migrasi, perintah approval (M4), memori proyek (M5).

## Menambah login Hostinger

Di terminal sendiri (PowerShell atau Windows Terminal, bukan `!` di Claude Code):

```powershell
corepack pnpm build
corepack pnpm ops:login:add <alias>     # meminta token bila belum tersimpan; ketikan tidak tampil
```

Lalu di Claude Code: minta `verify_login_connection` untuk alias itu. Untuk mengganti token: `corepack pnpm ops:secret:set HOSTINGER_TOKEN_<ALIAS>`.

## Menjalankan

```bash
corepack pnpm install
corepack pnpm infra:up      # PostgreSQL
corepack pnpm db:migrate
corepack pnpm build         # MCP server dijalankan Claude Code dari dist/
corepack pnpm dev:api       # biarkan berjalan selama memakai Claude Code
```

`corepack pnpm` bisa diganti `pnpm` bila pnpm terpasang global. Test (`pnpm test`) memakai database terpisah `hostinger_ops_test` di container yang sama dan mengosongkannya setiap kali dijalankan.
