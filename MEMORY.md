# MEMORY.md — Catatan serah-terima

Untuk agent berikutnya. Baca ini dulu, lalu `PRD.md` dan `AGENT.md`.

## Posisi terakhir (12 November 2026)

- **M1 (Fondasi) selesai** — rencana `docs/superpowers/plans/2026-11-11-m1-foundation.md`. Review akhir M1 hanya pemeriksaan sendiri (reviewer independen dihentikan pemilik). Dua temuan kecil M1 ditunda:
  - Hook `commit-msg` menolak pesan apa pun yang memuat frasa "generated with", termasuk pesan sah seperti "Add migration generated with prisma diff".
  - `API_PORT` bukan angka menghasilkan error listen yang kurang jelas.
- **M2 (Vault, login, uji koneksi) selesai** — rencana `docs/superpowers/plans/2026-11-12-m2-vault-logins.md`, tugas 1–6. Pemilik mendaftarkan dua login pilot dari terminalnya sendiri; keduanya `CONNECTED` dengan 4/4 kemampuan (lihat `docs/API-CAPABILITIES.md`). Alias asli ada di database lokal, sengaja tidak ditulis di repo.
- Review akhir M2 oleh reviewer independen: tidak ada temuan kritis; tiga temuan penting sudah diperbaiki (berhenti menguji saat kena rate limit, tolak token berisi karakter tak terlihat, `ops:login:add` memeriksa terminal paling awal). Tiga temuan kecil ditunda:
  - Penulisan hasil verifikasi (kemampuan, status, audit) belum dalam satu transaksi; dua verifikasi bersamaan untuk login yang sama bisa saling menyela.
  - Catatan probe DNS berbunyi "no domain in portfolio to probe" juga saat request portfolio-nya sendiri gagal; hanya item pertama portfolio yang dilihat.
  - Pesan penolakan non-interaktif kurang jelas bagi pengguna Git Bash (mintty, `isTTY` false): sebutkan PowerShell atau Windows Terminal.
- **Berikutnya: M3** (inventaris: sinkronisasi paket dan website, antrean di PostgreSQL; PRD §12). Belum ada rencananya. Jangan mulai sebelum pemilik menyuruh; tulis rencananya dulu dengan skill writing-plans. Pembatas laju per login saat ini hanya di dalam proses API (`shortcut:` di `rate-limiter.ts`); pindahkan ke penyimpanan bersama saat worker ikut memanggil Hostinger.

## Yang sudah ada

| Bagian | Keadaan |
| :--- | :--- |
| `packages/shared` | AES-256-GCM + skema Zod respons |
| `packages/database` | Skema Prisma lengkap PRD §7.1, migrasi `20261111000000_init` (termasuk trigger hanya-tambah `audit_logs`), `createDb`, `createTestDb` |
| `packages/hostinger-adapter` | Client Hostinger (Bearer, 30 detik, 90/menit per login, 429 + `Retry-After` maks 60 detik, 3 percobaan), penyedia token dari vault, 4 probe baca-saja |
| `apps/api` | Fastify `127.0.0.1:3000`, kunci internal `x-api-key`, route inventaris baca-saja, `POST /v1/logins/:alias/verify` dengan audit per panggilan Hostinger |
| `apps/api/src/cli` | `ops:secret:set <NAME>` dan `ops:login:add <alias>`; menolak stdin non-interaktif; dijalankan dari `apps/api/dist` (perlu `corepack pnpm build`) |
| `apps/mcp-server` | 5 tool: `list_logins`, `list_accounts`, `list_websites`, `get_login_capabilities`, `verify_login_connection`; `.mcp.json` di root |
| `infra/docker-compose.yml` | Hanya PostgreSQL 17; container `ops-postgres` berjalan di `127.0.0.1:5433` |
| `docs/` | `ARCHITECTURE.md`, `SECURITY.md`, `API-CAPABILITIES.md` |
| Test | 95 test; `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` lolos |

Belum ada: worker, antrean, sinkronisasi inventaris, `ssh-adapter`, `ops:approve`/`ops:reject`, kelima `SKILL.md`.

Catatan operasional:
- Setelah kode berubah: `corepack pnpm build`, matikan lalu nyalakan ulang `corepack pnpm dev:api`, dan `/mcp` (reconnect) di Claude Code.
- Selama API berjalan, `corepack pnpm install` gagal di `prisma generate` (EPERM: file engine Prisma terkunci). Matikan API dulu bila skema berubah.
- Port 3000 bisa tertahan oleh API lama yang dijalankan lewat `!` di sesi Claude Code; periksa dengan `Get-NetTCPConnection -LocalPort 3000` sebelum menyalakan ulang.

Git: branch `main`, belum ada remote, belum pernah push.

## Keputusan implementasi yang perlu diketahui

- Database test terpisah `hostinger_ops_test` (bukan schema `test`), karena SQL migrasi Prisma 6.19 memakai schema `public` secara eksplisit.
- Skrip root memanggil sub-perintah dengan `corepack pnpm`, karena pnpm tidak terpasang global di PC ini.
- Migrasi dibuat dengan `prisma migrate diff --from-empty`, karena `migrate dev` menolak shell non-interaktif. Untuk migrasi berikutnya: `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` (butuh shadow database) atau jalankan `migrate dev` di terminal interaktif.
- `.env` lokal: port database `5433` karena `5432` dipakai proyek lain. `.env.example` tetap `5432`.
- MCP server membaca `.env` di root tetapi hanya menyimpan `HOSTING_OPS_API_KEY` dan `API_PORT`.
- Pesan error tool MCP menyertakan kode error API bila ada (misal `(404): login_not_found`); batas waktu 10 detik punya pesan sendiri.
- API menolak parameter query berulang (`?domain=a&domain=b`) dengan 400.
- Commit pertama `3095c97` dibuat sebelum pemeriksaan lolos (melanggar AGENT.md §3); semua commit sesudahnya lolos pemeriksaan.

## Keputusan pemilik yang penting (rinciannya di PRD.md)

- Operator tunggal; sedikit login Hostinger, banyak paket shared.
- Prioritas: migrasi WordPress bergelombang (sekitar 20 website) antar login.
- Alur: salin ke dummy `*.hostingersite.com` → approve sekali per gelombang → hapus sumber → pasang domain asli → DNS/SSL.
- Uji dummy otomatis saja; cadangan lokal tidak dihapus otomatis; gagal → berhenti dan lapor; tidak ada sinkron ulang sebelum hapus.
- Email tidak disentuh; website dengan email Hostinger, domain mati, atau subdomain/cron/database tambahan ditahan di dummy.
- Keamanan "kunci sedang"; antrean di PostgreSQL tanpa Redis; cadangan database pusat ke folder sinkron cloud.
- Identitas Git global di PC ini dikonfirmasi pemilik untuk commit.
- Jangan pernah menulis username hosting, IP, domain, atau token sungguhan ke file mana pun.
- "Build PRD" dari pemilik berarti menulis dokumen; implementasi hanya bila disuruh eksplisit.

## Fakta lingkungan

- Node v22.23.2 (PRD menargetkan 24; semua paket mendukung 22). pnpm lewat `corepack pnpm` (terkunci `pnpm@10.20.0`).
- Versi terpasang: TypeScript 6.0.x, Prisma 6.19.x, Zod 4.x, Fastify 5.x, Vitest 4.1.x, `@modelcontextprotocol/server` 2.4.0 (API v2: `registerTool` dengan `z.object`, `serveStdio` dari `@modelcontextprotocol/server/stdio`).
- Port 5432 dan 6379 dipakai proyek lain di PC ini.

## Belum diverifikasi

- Delapan butir perilaku Hostinger API di PRD §3.3 (dikerjakan di M4a).
- Nama kunci pengaturan `attribution` di `.claude/settings.json` (hook `commit-msg` tetap menolak atribusi AI).
