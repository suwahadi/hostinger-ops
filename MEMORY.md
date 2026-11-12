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
- **M3 (Inventaris & kapasitas) selesai secara kode** — rencana `docs/superpowers/plans/2026-11-12-m3-inventory.md`. Sinkronisasi pilot: 54 paket dan 784 website dari dua login, dua putaran tanpa perubahan (lihat `docs/API-CAPABILITIES.md`). **Masih menunggu pemilik:** mencocokkan jumlah paket dan website dengan hPanel.
- Keputusan pemilik M3:
  - worker berjalan **di dalam proses API**;
  - paket yang terlihat dari beberapa login dicatat **sekali dengan banyak akses** (`hosting_account_access`), dan pemiliknya login yang membayar tagihannya. Ini menyimpang dari PRD §7.1 (lihat `docs/ARCHITECTURE.md`).
- Belum terjawab: apakah 28 paket di login A (lihat `docs/API-CAPABILITIES.md`) tanpa data billing adalah paket klien. Pemilik menjawab "campuran / tidak yakin". Daftar billing login itu lengkap (244 langganan), tetapi tidak memuat ke-28 paket tersebut.
- Review akhir M3 oleh reviewer independen: tiga temuan penting diperbaiki (domain beda huruf besar-kecil, halaman pendek dipercaya, kapasitas menghitung paket UNKNOWN). Perubahan akses-bersama dibuat **sesudah** review itu dan hanya dicakup test, tanpa review independen. Temuan kecil yang ditunda:
  - job tetap `RUNNING` bila pencatatan gagalnya sendiri gagal, sampai API dinyalakan ulang;
  - `recoverStaleJobs` mengabaikan `attempts`;
  - domain ganda tidak dihitung di hasil;
  - order `UNLISTED` dan `root_directory` kosong menimpa `webRoot` dengan null;
  - kegagalan daftar billing menggagalkan seluruh sinkronisasi;
  - pesan "unexpected response shape" tidak menyebut field;
  - sinkronisasi yang gagal tidak menulis baris audit (`POST /v1/sync` sekarang menulis `SYNC_REQUEST`);
  - beberapa jalur belum dites (balapan P2002, pemulihan saat worker mulai, gagal halaman 2 di level prosesor).
- **Tampilan web selesai** (di luar PRD §2.2, diminta pemilik 12 Nov 2026):
  - spec `docs/superpowers/specs/2026-11-12-web-dashboard-design.md`, rencana `docs/superpowers/plans/2026-11-12-web-dashboard.md`;
  - `http://127.0.0.1:3000/`, login password (`ops:ui:password`), halaman Ringkasan, Paket, Website, dan Sinkron & Audit, dua tombol baca-saja;
  - diuji di browser lewat pratinjau database test. Pemilik belum membuat password atau membukanya dengan data asli (Tugas 7 rencana itu).
- **GitHub:** `origin` = `https://github.com/suwahadi/hostinger-ops.git`, branch `main` saja, identitas `suwahadi <suwahadi@gmail.com>`, tanpa atribusi AI. Push setelah setiap revisi yang lolos pemeriksaan (AGENT.md §4).
- **Berikutnya: M4** (migrasi WordPress; mulai dari M4a, pembuktian perilaku API di akun pilot). Belum ada rencananya. Jangan mulai sebelum pemilik menyuruh.

## Yang sudah ada

| Bagian | Keadaan |
| :--- | :--- |
| `packages/shared` | AES-256-GCM + skema Zod respons |
| `packages/database` | Skema Prisma lengkap PRD §7.1, migrasi `20261111000000_init` (termasuk trigger hanya-tambah `audit_logs`), `createDb`, `createTestDb` |
| `packages/hostinger-adapter` | Client Hostinger (Bearer, 30 detik, 90/menit per login, 429 + `Retry-After` maks 60 detik, 3 percobaan), penyedia token dari vault, 4 probe baca-saja, paginasi |
| `apps/worker` | Antrean `jobs` di PostgreSQL, loop worker (berjalan di proses API), prosesor `sync-login` |
| `apps/api` | Fastify `127.0.0.1:3000` + worker, kunci internal `x-api-key`; route inventaris, detail website, kapasitas, verifikasi, sinkronisasi; halaman web di `src/web` (sesi cookie, terpisah dari `/v1`) |
| `apps/api/src/cli` | `ops:secret:set <NAME>`, `ops:login:add <alias>`, `ops:ui:password`; menolak stdin non-interaktif; dijalankan dari `apps/api/dist` (perlu `corepack pnpm build`) |
| `apps/mcp-server` | 8 tool: `list_logins`, `list_accounts`, `list_websites`, `get_login_capabilities`, `verify_login_connection`, `trigger_inventory_sync`, `get_website_details`, `get_capacity_report`; `.mcp.json` di root |
| `infra/docker-compose.yml` | Hanya PostgreSQL 17; container `ops-postgres` berjalan di `127.0.0.1:5433` |
| `docs/` | `ARCHITECTURE.md`, `SECURITY.md`, `API-CAPABILITIES.md` |
| Test | 194 test; `corepack pnpm typecheck && corepack pnpm test && corepack pnpm build` lolos |

Belum ada: `ssh-adapter`, migrasi, `ops:approve`/`ops:reject`, memori proyek, kelima `SKILL.md`.

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
