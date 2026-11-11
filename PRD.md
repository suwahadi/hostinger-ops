# Product Requirements Document (PRD): Hostinger Ops v2.0

| Metadata | Detail |
| :--- | :--- |
| **Nama Proyek** | `hostinger-ops` |
| **Versi Dokumen** | 2.0.0 — FINAL, disetujui pemilik 11 November 2026 |
| **Tanggal** | 11 November 2026 |
| **Menggantikan** | PRD v1.0.0 (11 November 2026) |
| **Operator** | Satu orang, satu PC Windows 11 |
| **Operator AI** | Claude Code (MCP STDIO + repository skills) |
| **Beban kerja** | Hampir semua WordPress; sebagian kecil Laravel / PHP lain |

Catatan penulisan: dokumen ini tidak boleh memuat username hosting, alamat IP, domain, atau token sungguhan. Semua contoh memakai nama samaran (`sumber`, `tujuan`, `contoh.com`).

---

## 1. Untuk apa sistem ini

Pemilik mengelola banyak paket shared hosting Hostinger yang tersebar di beberapa login. Pekerjaan yang paling sering dan paling melelahkan adalah **memindahkan website dalam gelombang besar (sekitar 20 website sekaligus) dari satu login ke login lain**. Pemicunya: paket mau habis, akun penuh atau lambat, konsolidasi, dan serah-terima klien.

Hari ini pekerjaan itu dilakukan dengan mengetik satu prompt panjang ke Claude Code, yang lalu bekerja lewat SSH dan API token Hostinger. Cara itu berhasil, tetapi:

- tidak ada catatan tetap tentang website mana sudah sampai langkah mana, sehingga gelombang yang terputus sulit dilanjutkan;
- token dan detail SSH ikut berada di percakapan;
- langkah yang merusak (menghapus website sumber) hanya dijaga oleh kalimat di prompt.

Hostinger Ops menggantikan prompt panjang itu dengan sistem lokal yang mengingat keadaan, menyimpan kredensial terenkripsi, dan menahan langkah merusak di balik persetujuan manusia.

**Ukuran berhasil:** pemilik bisa berkata kepada Claude "pindahkan 20 website ini dari `sumber` ke `tujuan`", menerima laporan uji salinan, menyetujui sekali di terminal, dan mendapati semua website yang layak sudah hidup di tujuan, dengan yang bermasalah berhenti di tempat aman dan tercatat jelas alasannya.

---

## 2. Sasaran, bukan sasaran, pantangan

### 2.1 Sasaran versi 1 (berurutan)

1. Migrasi WordPress bergelombang antar login Hostinger.
2. Inventaris semua login, paket, dan website di satu tempat.
3. Memori klien dan proyek (klien, proyek, aturan, catatan) yang dibaca Claude sebelum bekerja.
4. Provisioning website baru dan perubahan DNS di luar konteks migrasi.
5. Migrasi Laravel / PHP lain.
6. Monitoring berkala (HTTP, SSL, kedaluwarsa domain) dan cadangan database pusat.

### 2.2 Bukan sasaran versi 1

- Memindahkan mailbox email. Website dengan email Hostinger berhenti di alamat dummy; emailnya diurus pemilik.
- Memulihkan otomatis ke akun sumber setelah gagal.
- Cloudflare, VPS, dan Cloud Hosting.
- Dashboard web. Antarmukanya Claude Code dan perintah terminal.
- Banyak operator atau banyak PC.
- Redis / BullMQ (lihat 5.2).

### 2.3 Pantangan (gagal walaupun "jalan")

1. **Data website hilang.** Tidak ada website sumber yang dihapus tanpa cadangan lokal yang checksum-nya cocok dan salinan dummy yang lolos uji.
2. **Token atau kredensial bocor** ke percakapan Claude, log, atau file dalam repo.
3. **Website mati lama.** Satu kegagalan tidak boleh menyeret website lain, dan website yang gagal harus bisa dilanjutkan dengan satu perintah.

---

## 3. Fakta yang menjadi dasar

### 3.1 Dari pemilik

| Hal | Keadaan |
| :--- | :--- |
| Kepemilikan akun | Sedikit login Hostinger; tiap login memegang banyak paket |
| Jenis paket | Shared Premium, Business, Unlimited |
| Arah migrasi | Biasanya antar login berbeda (dua token) |
| Ukuran gelombang | Sekitar 20 website |
| Ukuran website | Di bawah 1 GB |
| DNS | Nameserver Hostinger |
| Email di Hostinger | Sebagian kecil domain |
| SSH | Kunci SSH sudah terpasang di akun-akun |
| Downtime yang boleh | Beberapa menit per website |
| Token | Diberi nama samaran oleh pemilik (misal `sumber`, `tujuan`) |

### 3.2 Dari dokumentasi Hostinger API (dicek 11 November 2026)

Sudah dipastikan dari dokumentasi:

- Token dibuat di hPanel, **berlaku per login** dan mewarisi seluruh izin login itu. Tidak ada token read-only.
- Batas **90 request per menit per login**. Respons memuat `X-RateLimit-Limit`, `X-RateLimit-Remaining`; saat 429 ada `Retry-After`. Pelanggaran berulang bisa memblokir IP.
- Daftar memakai `page` dan `per_page`. `202 Accepted` berarti proses berjalan di belakang; cara menunggunya adalah membaca ulang resource, bukan mengirim ulang.
- Grup Hosting (80 endpoint): website (daftar, buat lewat *website setup* per order, hapus), database (buat, hapus, ganti password, remote connection), file (upload URL, daftar, baca isi), PHP, SSL, cron, subdomain, parked domain, subdomain gratis, verifikasi kepemilikan domain, cache.
- Grup WordPress (40 endpoint): install, **impor website dari arsip + database yang sudah diunggah**, deteksi instalasi, versi core, plugin, tema, LiteSpeed.
- Grup DNS (8 endpoint): baca, ubah, hapus, reset, validasi record; snapshot zone.
- `POST /api/hosting/v1/websites` sudah deprecated; penggantinya endpoint onboarding per order.

Tidak ada di API: backup / snapshot / restore shared hosting, migrasi antar akun, kredensial SSH / SFTP, export SQL.

**Akibatnya:** jalur "native snapshot & migration" di PRD v1 dihapus. Sumber selalu dibaca lewat SSH; target disiapkan lewat API bila bisa, lewat SSH bila tidak.

### 3.3 Belum terbukti — wajib dibuktikan di akun pilot sebelum kode migrasi ditulis (lihat M4a)

1. Apakah satu domain bisa terpasang di dua login sekaligus. Alur pemilik mengandaikan tidak bisa.
2. Cara mengganti domain utama sebuah website dari `*.hostingersite.com` ke domain asli (API, atau harus buat ulang website).
3. Parameter, format, dan batas ukuran endpoint impor WordPress dan upload URL.
4. Apa yang terjadi pada DNS zone sebuah domain ketika websitenya dihapus dari login sumber dan dipasang di login tujuan.
5. Apakah API memberi angka pemakaian disk dan sisa slot website per paket.
6. Apakah host, port, dan username SSH bisa dibaca dari API, atau harus dimasukkan manual.
7. Apakah API memberi tahu sebuah domain punya mailbox Hostinger.
8. Apakah menghapus website lewat API ikut menghapus database-nya.

Setiap butir yang ternyata "tidak bisa lewat API" jatuh ke jalur SSH atau menjadi masukan manual; tidak ada yang menggagalkan rancangan.

---

## 4. Prinsip desain

1. **Token tidak pernah sampai ke Claude.** MCP server hanya berbicara dengan API lokal memakai kunci internal. Token Hostinger didekripsi hanya di memori proses API / worker. Respons, log, dan pesan error tidak pernah memuat token, password database, atau isi `wp-config.php`.
2. **Periksa kemampuan, jangan berasumsi.** Tiap login diuji fitur mana yang benar-benar bisa dipakai, hasilnya disimpan, dan tiap operasi membaca hasil itu.
3. **Langkah merusak butuh persetujuan manusia di terminal.** Menghapus website, menghapus database, dan mengubah record DNS email ditolak backend tanpa `Approval` berstatus `APPROVED`.
4. **Tidak ada hapus tanpa bukti.** Website sumber hanya dihapus bila cadangan lokal lolos checksum dan salinan dummy lolos uji.
5. **Data bisnis tidak ditimpa sinkronisasi.** Sinkronisasi dari Hostinger hanya menyentuh data teknis; klien, proyek, aturan, dan catatan tidak pernah dihapus atau ditimpa.
6. **Bisa dilanjutkan.** Tiap langkah migrasi dicatat di PostgreSQL. Setelah PC tidur atau restart, pekerjaan melanjutkan dari langkah terakhir yang selesai. Tiap langkah aman dijalankan ulang.
7. **Satu kegagalan, satu website.** Website yang gagal berhenti dan dilaporkan; website lain di gelombang tetap berjalan.

---

## 5. Stack

### 5.1 Arah (ditetapkan)

- Windows 11, Docker Desktop (WSL2) hanya untuk PostgreSQL, diikat ke `127.0.0.1`.
- Node.js LTS terbaru, TypeScript `strict`, pnpm workspace.
- Fastify (API lokal `127.0.0.1:3000`), Prisma + PostgreSQL 17, Zod, Vitest.
- MCP SDK resmi TypeScript dengan transport `stdio`.
- API, worker, dan MCP server berjalan langsung di host, bukan di Docker.

Nomor versi dan nama paket di PRD v1 (Node 24, TypeScript 6, Prisma 6.19, Zod 4, MCP SDK 2.4, Vitest 4) adalah **sasaran, bukan kunci**. Builder memverifikasinya saat instalasi dan melaporkan setiap perbedaan; arah stack tidak boleh diganti tanpa bertanya.

### 5.2 Antrean di PostgreSQL

Redis dan BullMQ dihapus. Pekerjaan latar (sinkronisasi, langkah migrasi, monitoring) diantrekan di PostgreSQL. Alasannya: satu operator, satu PC, puluhan pekerjaan per gelombang; satu layanan lebih sedikit berarti lebih sedikit yang bisa rusak, dan keadaan migrasi memang sudah di PostgreSQL. Pilihan pustaka (misalnya `pg-boss`) atau tabel antrean sendiri diserahkan ke builder.

### 5.3 Catatan Windows

- `.mcp.json` memanggil `node` secara eksplisit dengan garis miring biasa.
- `.gitattributes`: `* text=auto eol=lf`.
- Worker mencegah PC tidur selama gelombang berjalan; bila tetap terputus, prinsip 6 berlaku.

---

## 6. Struktur repositori

```text
hostinger-ops/
├── apps/
│   ├── api/            # Fastify API lokal + perintah CLI (src/cli/)
│   ├── mcp-server/     # MCP STDIO; hanya memanggil API lokal
│   └── worker/         # Pemroses antrean: sinkronisasi, migrasi, monitoring
├── packages/
│   ├── database/       # Skema Prisma, migrasi, client
│   ├── hostinger-adapter/  # HTTP client, pembatas laju per login, probing, modul endpoint
│   ├── ssh-adapter/    # Perintah jarak jauh dan transfer file lewat SSH
│   └── shared/         # Skema Zod, konstanta, enkripsi AES-256-GCM
├── .claude/
│   ├── settings.json   # Aturan deny (lihat 8.3)
│   └── skills/         # hosting-operations, website-migration, website-provisioning,
│                       # dns-management, incident-response
├── docs/               # ARCHITECTURE.md, SECURITY.md, API-CAPABILITIES.md
├── data/               # backups/ dan exports/ (di-ignore Git)
├── infra/docker-compose.yml   # Hanya PostgreSQL 17
├── .githooks/commit-msg       # Menolak atribusi AI di pesan commit (AGENT.md §5)
├── .env.example  .gitignore  .gitattributes  .mcp.json
├── CLAUDE.md  AGENT.md        # CLAUDE.md memuat AGENT.md (aturan coding dan repo)
└── package.json  pnpm-workspace.yaml  tsconfig.json  PRD.md
```

---

## 7. Model data

PRD v1 memakai satu `HostingAccount` per token. Itu tidak cocok dengan kenyataan (satu token, banyak paket), jadi hierarkinya menjadi tiga tingkat:

```text
HostingerLogin (token, kuota 90/menit)
  └── HostingAccount (satu paket/order: username hosting, paket, pusat data, detail SSH)
        └── Website (domain, jenis aplikasi, web root, status)
```

`principalGroup` dari PRD v1 dihapus; perannya digantikan `HostingerLogin`.

### 7.1 Tabel

| Tabel | Isi pokok |
| :--- | :--- |
| `HostingerLogin` | `alias` (unik, nama samaran dari pemilik), `tokenRef` → SecretVault, status koneksi, `lastVerifiedAt` |
| `HostingCapability` | per login: nama kemampuan, `available`, status HTTP, catatan, `checkedAt` |
| `HostingAccount` | `loginId`, `code`, id order, username hosting, jenis paket, pusat data, host/port SSH, jumlah website, batas website, pemakaian disk bila tersedia, `lastSyncedAt` |
| `Website` | `accountId`, `domain`, `websiteType` (`WORDPRESS`, `LARAVEL`, `CUSTOM_PHP`, `STATIC`, `UNKNOWN`), `webRoot`, versi PHP, `metadata` (JSON), `status`, `projectId` (opsional) |
| `WebsiteDatabase` | `websiteId`, nama database, user, `credentialRef` → SecretVault |
| `Domain`, `DnsRecord` | Domain yang dikenal dan salinan record terakhir |
| `MigrationWave` | sumber, tujuan, daftar domain yang diminta, status, `approvalId`, jalur laporan |
| `MigrationJob` | satu website dalam satu gelombang: `waveId`, `websiteId`, klasifikasi domain, status, alamat dummy, jalur cadangan, alasan berhenti |
| `MigrationStep` | `jobId`, nama langkah, status, percobaan ke-, mulai, selesai, ringkasan hasil, error yang sudah disaring |
| `Backup` | `jobId`, jalur arsip file dan dump, ukuran, SHA-256, manifest (jumlah file, jumlah tabel) |
| `Approval` | `id` pendek (`APR-XXXXX`), `action`, `resourceId`, `payloadHash`, ringkasan dampak, status, `expiresAt`, `approvedBy`, alasan |
| `OperationLock` | kunci per website / domain agar tidak disentuh dua pekerjaan sekaligus |
| `SecretVault` | `refKey` (unik), `category`, `cipherText`, `iv`, `authTag`, `keyVersion`, `lastUsedAt` |
| `AuditLog` | hanya-tambah: `requestId`, `actor` (`CLAUDE_MCP`, `CLI_HUMAN`, `WORKER`), `action`, `resource`, `resourceId`, `result` |
| `Client`, `Project`, `ProjectRule`, `GlobalRule`, `KnowledgeItem` | Memori bisnis (M5) |
| `MonitoringCheck` | Hasil pemeriksaan berkala (M8) |

Enum: `SecretCategory` (`API_TOKEN`, `DB_CREDENTIAL`, `SSH_CREDENTIAL`, `PROVIDER_KEY`); `ApprovalStatus` (`PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONSUMED`).

Nama kolom persis, indeks, dan relasi diserahkan ke builder, dengan syarat: upsert website memakai kunci (`accountId`, `domain`), dan `AuditLog` tidak pernah di-update atau dihapus.

### 7.2 Aturan sinkronisasi

- Login → paket ditemukan otomatis dari API; pemilik tidak mendaftarkan paket satu per satu.
- Website yang hilang dari respons API tidak dihapus; statusnya menjadi `UNKNOWN`.
- `projectId` dan semua data bisnis dipertahankan.

---

## 8. Keamanan ("kunci sedang", pilihan pemilik)

### 8.1 Vault

- Satu kunci utama `SECRETS_MASTER_KEY` (256-bit) di `.env`. Semua token, password database, dan passphrase SSH disimpan terenkripsi AES-256-GCM di `SecretVault`.
- `pnpm ops:secret:set <refKey>` membaca nilai dari prompt tersembunyi di terminal; nilai tidak pernah menjadi argumen perintah.
- Fallback ke `process.env[tokenRef]` hanya aktif bila `NODE_ENV=development`.

### 8.2 Approval di luar jalur AI

1. Tool MCP membuat `Approval` berstatus `PENDING` dan mengembalikan `approvalId` serta ringkasan dampak. Tidak ada tool MCP untuk menyetujui.
2. Pemilik menjalankan `pnpm ops:approve <id> --reason "..."` di terminal terpisah. Perintah menampilkan detail, meminta `[y/N]`, dan **menolak berjalan bila input bukan terminal interaktif**.
3. Saat eksekusi, backend memeriksa: status `APPROVED`, belum kedaluwarsa, `action` + `resourceId` + `payloadHash` cocok. Lalu menandai `CONSUMED`.

Masa berlaku: 15 menit untuk operasi tunggal; 60 menit untuk persetujuan gelombang, karena laporannya perlu dibaca.

### 8.3 Lapis tambahan dan batas yang diakui

`.claude/settings.json` berisi aturan deny untuk membaca `.env` dan menjalankan `pnpm ops:approve`, `ops:reject`, `ops:secret:*`.

**Risiko yang diterima:** Claude Code berjalan di PC yang sama dengan akses terminal. Aturan deny dan pemeriksaan terminal interaktif mempersulit, tetapi bukan batas keamanan mutlak. Pemilik memilih tingkat ini dengan sadar. Peningkatan yang tersedia nanti: kunci utama di Windows Credential Manager dan passphrase pada perintah approve. Ini dicatat di `docs/SECURITY.md`.

### 8.4 Log

Semua mutasi dan pembacaan sensitif masuk `AuditLog`. Error dari Hostinger dan SSH disaring sebelum disimpan atau dikembalikan.

---

## 9. Migrasi WordPress bergelombang

### 9.1 Gambaran

```text
Pemilik → Claude: "pindahkan domain-domain ini dari `sumber` ke `tujuan`"
   │
   ▼
TAHAP A — menyalin (tanpa approval, tidak merusak apa pun)
   periksa → cadangkan → siapkan target → pulihkan ke dummy → uji dummy
   │
   ▼
Laporan gelombang + permintaan approval (satu untuk seluruh gelombang)
   │   pemilik: pnpm ops:approve APR-XXXXX
   ▼
TAHAP B — cutover (satu website pada satu waktu)
   simpan DNS → hapus di sumber → pasang domain asli → DNS + SSL → uji langsung
```

### 9.2 Tahap A, per website

| Langkah | Yang dikerjakan | Berhenti bila |
| :--- | :--- | :--- |
| `PREFLIGHT` | Kemampuan kedua login; sisa slot dan disk target; versi PHP; SSH sumber bisa dijangkau; deteksi WordPress; klasifikasi domain (9.4); ambil `OperationLock`; ruang disk PC cukup | Salah satu syarat gagal |
| `SOURCE_BACKUP` | Lewat SSH: dump database, arsipkan file (tanpa folder cache), unduh ke `data/backups/<waveId>/<jobId>/`; SHA-256 dihitung di server dan dicocokkan di PC; tulis manifest (jumlah file, jumlah tabel, ukuran) | Checksum tidak cocok |
| `TARGET_PROVISION` | Buat website di target dengan subdomain gratis `*.hostingersite.com`; buat database; samakan versi PHP | API menolak dan tidak ada jalur lain |
| `RESTORE` | Unggah arsip dan dump; pulihkan (impor WordPress lewat API bila terbukti bekerja, bila tidak lewat SSH di target); sesuaikan `wp-config.php`; ganti URL ke alamat dummy | Impor gagal |
| `DUMMY_VERIFY` | Alamat dummy menjawab HTTP 200; tidak ada pesan error database atau PHP fatal; jumlah file dan jumlah tabel sama dengan manifest | Salah satu cek gagal |

Lolos semua → `DUMMY_READY`. Tahap A boleh berjalan beberapa website sekaligus (bawaan 3), selalu di bawah batas laju per login.

**Syarat layak** (pilihan pemilik): uji otomatis saja. Laporan tetap memuat tautan dummy.

### 9.3 Tahap B, per website, hanya untuk yang tercakup approval

| Langkah | Yang dikerjakan |
| :--- | :--- |
| `PRE_DELETE_CHECK` | Hitung ulang SHA-256 cadangan di disk; ulangi `DUMMY_VERIFY`. Gagal → berhenti, sumber tidak disentuh |
| `DNS_SNAPSHOT` | Simpan seluruh record zone saat ini ke database |
| `SOURCE_REMOVE` | Hapus website dari login sumber |
| `DOMAIN_ATTACH` | Pasang domain asli ke website di target (verifikasi kepemilikan bila diminta); ganti URL dari dummy ke domain asli |
| `DNS_SSL` | Arahkan record A / CNAME website ke target; terbitkan SSL. Record MX dan TXT tidak pernah disentuh |
| `LIVE_VERIFY` | Uji HTTPS domain asli langsung ke IP target; HTTP 200 tanpa error |

Selesai → `DONE`. Tahap B berjalan **satu website pada satu waktu** supaya jeda tiap website tetap beberapa menit dan kegagalan tidak menumpuk.

### 9.4 Klasifikasi domain

| Klasifikasi | Arti | Perlakuan |
| :--- | :--- | :--- |
| `READY` | Domain aktif, DNS di Hostinger, tanpa email Hostinger | Tahap A dan B |
| `HAS_HOSTINGER_EMAIL` | Ada mailbox Hostinger | Tahap A saja; ditahan di dummy; dilaporkan untuk dikonfirmasi pemilik. Bila pemilik memutuskan lanjut, website dimasukkan ke gelombang cutover berikutnya; email tetap tidak disentuh |
| `DOMAIN_INACTIVE` | Domain mati, expired, atau DNS sudah di provider lain | Tahap A saja; selesai di dummy |
| `HAS_EXTRAS` | Ditemukan subdomain, parked domain, cron job, atau database selain yang dipakai `wp-config.php` | Tahap A saja; ditahan di dummy; temuan dirinci di laporan untuk diputuskan pemilik |

Salin ke dummy **selalu wajib** untuk semua klasifikasi.

**Yang dihitung "satu website"** (pilihan pemilik): folder web domain itu dan satu database yang dipakai `wp-config.php`. Hal lain tidak disalin otomatis; keberadaannya menahan website di dummy (`HAS_EXTRAS`) supaya tidak ada yang hilang saat sumber dihapus.

**Perubahan di sela waktu** (pilihan pemilik, risiko diterima): tidak ada sinkron ulang antara `SOURCE_BACKUP` dan `SOURCE_REMOVE`. Perubahan di website sumber setelah cadangan diambil (komentar, isian form, pesanan) tidak ikut pindah. Laporan gelombang mencantumkan waktu cadangan tiap website agar pemilik bisa menilai.

### 9.5 Approval gelombang

- Dibuat setelah semua pekerjaan Tahap A berakhir (lolos atau berhenti).
- `action = MIGRATION_WAVE_CUTOVER`, `resourceId = waveId`, `payloadHash` dihitung dari daftar pekerjaan `READY` yang berstatus `DUMMY_READY`.
- Satu approval mencakup `SOURCE_REMOVE`, `DOMAIN_ATTACH`, dan `DNS_SSL` untuk daftar itu saja. Website yang ditambahkan belakangan butuh approval baru.
- Approval ditandai `CONSUMED` saat Tahap B dimulai dan tetap berlaku untuk daftar itu sampai tiap pekerjaan selesai atau berhenti, walaupun melewati 60 menit. Pekerjaan yang berhenti **sebelum** `SOURCE_REMOVE` butuh approval baru untuk dilanjutkan; yang berhenti **sesudahnya** boleh dilanjutkan tanpa approval baru, karena bagian merusaknya sudah terjadi.
- `SOURCE_REMOVE` hanya menghapus website. Database sumber tidak dihapus sistem; bila Hostinger ikut menghapusnya (3.3 butir 8), hal itu dinyatakan di ringkasan dampak.
- Bila zone DNS ternyata ter-reset ketika website dipindah (3.3 butir 4), `DNS_SSL` mengembalikan record persis seperti `DNS_SNAPSHOT`, termasuk MX dan TXT. Ini tercakup approval gelombang dan disebut di ringkasan dampak. "Tidak menyentuh MX dan TXT" berarti isinya tidak pernah berbeda dari snapshot.
- Ringkasan dampak yang ditampilkan di terminal: jumlah website, daftar domain, pernyataan bahwa website sumber akan dihapus, dan lokasi cadangan.

### 9.6 Laporan gelombang

Ditulis ke `data/exports/wave-<id>.md` dan dikembalikan ke Claude. Per website: domain, klasifikasi, status, alamat dummy, hasil tiap cek, ukuran cadangan, dan alasan berhenti bila ada. Tanpa kredensial.

### 9.7 Kegagalan

- Gagal di Tahap A: pekerjaan berhenti, sumber utuh, tidak masuk daftar approval.
- Gagal di Tahap B sebelum `SOURCE_REMOVE`: berhenti, sumber utuh.
- Gagal di Tahap B setelah `SOURCE_REMOVE`: langkah dicoba ulang otomatis beberapa kali; bila tetap gagal, status `NEEDS_OPERATOR`. Website tetap hidup di alamat dummy, cadangan lokal aman, website berikutnya tetap dikerjakan. Pemilik melanjutkan dengan `resume_migration_job` setelah penyebabnya dibereskan.
- Tidak ada pemulihan otomatis ke sumber.

**Risiko yang diterima:** pada kasus terakhir domain asli tidak bisa diakses sampai pemilik turun tangan. Ini bertabrakan dengan pantangan "website mati lama"; penangkalnya adalah `PRE_DELETE_CHECK`, cutover satu per satu, percobaan ulang, dan pembuktian alur di akun pilot (M4a, M4c).

### 9.8 Cadangan lokal

- Tidak pernah dihapus otomatis (pilihan pemilik).
- `pnpm ops:backup:list` menampilkan ukuran per gelombang; `pnpm ops:backup:prune <waveId>` menghapus, hanya dari terminal manusia.
- `PREFLIGHT` menolak memulai bila ruang kosong disk PC di bawah ambang yang bisa diatur.

---

## 10. Beban kerja lain

### 10.1 Laravel / PHP lain (M7)

Tahap A dan B yang sama, dengan perbedaan di `RESTORE`: arsip mengecualikan `node_modules` dan `storage/framework/cache`; `.env` ikut dicadangkan; `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `APP_URL` disesuaikan; web root diarahkan ke `public`; `storage:link` dan pembersihan cache dijalankan lewat SSH. Metadata yang dicatat: versi PHP minimum, ekstensi yang dibutuhkan, keberadaan `.env`.

### 10.2 Metadata WordPress

Versi core, prefix tabel, status `wp-config.php`, status LiteSpeed Cache.

### 10.3 Provisioning dan DNS umum (M6)

Membuat website dan database baru di paket yang paling longgar menurut inventaris dan aturan proyek. Perubahan DNS: menambah atau mengubah record A / CNAME tidak butuh approval; **menghapus atau mengubah MX dan TXT (SPF, DKIM, DMARC) selalu butuh approval** dengan tanda konfirmasi eksplisit. Tiap perubahan DNS didahului snapshot.

### 10.4 Memori klien dan proyek (M5)

`Client`, `Project`, pemetaan website ke proyek, `ProjectRule` (misal "wajib PHP 8.3"), `GlobalRule`, `KnowledgeItem` (SOP, konfigurasi khusus, riwayat insiden). `PREFLIGHT` migrasi dan provisioning membaca aturan proyek dan berhenti bila dilanggar.

### 10.5 Monitoring dan cadangan pusat (M8)

- Pemeriksaan berkala: kode HTTP, waktu respons, masa berlaku SSL, kedaluwarsa domain → `MonitoringCheck`.
- `pg_dump` terenkripsi database pusat ke folder yang bisa diatur; pemilik mengarahkannya ke folder sinkron cloud (Google Drive / OneDrive). Kunci utama **tidak** disimpan di folder yang sama; pemilik menyimpannya terpisah (pengelola password).
- Impor massal login dari CSV.

---

## 11. Antarmuka

### 11.1 Tool MCP

| Tool | Tahap | Risiko | Guna |
| :--- | :--- | :--- | :--- |
| `list_logins` | M1 | Baca | Login, status koneksi, waktu sinkronisasi terakhir |
| `list_accounts` | M1 | Baca | Paket per login beserta kapasitas |
| `list_websites` | M1 | Baca | Cari website menurut login, paket, proyek, domain |
| `get_login_capabilities` | M1 | Baca | Kemampuan API yang sudah diuji |
| `verify_login_connection` | M2 | Tulis aman | Uji token dan perbarui kemampuan |
| `trigger_inventory_sync` | M3 | Tulis aman | Antrekan sinkronisasi |
| `get_website_details` | M3 | Baca | Detail satu website |
| `get_capacity_report` | M3 | Baca | Jumlah website, disk, paket yang longgar |
| `create_migration_wave` | M4 | Tulis aman | Buat gelombang dan jalankan Tahap A |
| `get_migration_wave_status` | M4 | Baca | Status dan laporan gelombang |
| `request_wave_cutover_approval` | M4 | Penjaga | Buat approval gelombang |
| `execute_wave_cutover` | M4 | Merusak, dilindungi | Jalankan Tahap B dengan `approvalId` |
| `resume_migration_job` | M4 | Dilindungi | Lanjutkan pekerjaan yang berhenti; tidak pernah melewati approval |
| `get_project_context` | M5 | Baca | Klien, proyek, aturan, catatan |
| `save_project_knowledge` | M5 | Tulis aman | Simpan catatan proyek |
| `request_operation_approval` | M6 | Penjaga | Approval untuk operasi tunggal |
| `manage_dns_records` | M6 | Dilindungi | Ubah DNS; record email butuh approval |
| `provision_website` | M6 | Tulis aman | Buat website dan database baru |
| `get_monitoring_status` | M8 | Baca | Hasil pemeriksaan terakhir |

### 11.2 Perintah terminal (hanya manusia)

| Perintah | Guna |
| :--- | :--- |
| `pnpm infra:up` / `infra:down` | PostgreSQL |
| `pnpm db:migrate` / `db:generate` | Skema |
| `pnpm ops:secret:set <refKey>` | Simpan rahasia lewat prompt tersembunyi |
| `pnpm ops:login:add <alias>` | Daftarkan login dan tokennya |
| `pnpm ops:account:ssh-set <code>` | Isi host, port, username SSH bila API tidak memberi |
| `pnpm ops:approve <id> --reason` / `ops:reject <id>` | Persetujuan |
| `pnpm ops:backup:list` / `ops:backup:prune <waveId>` | Cadangan lokal |
| `pnpm ops:login:import-csv <file>` | Impor massal (M8) |

Kunci SSH: sistem memakai file kunci yang sudah ada di PC pemilik; jalurnya diatur di `.env`, passphrase (bila ada) di vault.

---

## 12. Tahapan

Urutan diubah dari PRD v1: migrasi WordPress naik dari tahap 6 ke tahap 4.

### M1 — Fondasi
Monorepo, PostgreSQL di Docker, skema Prisma lengkap, modul enkripsi, API Fastify dengan autentikasi kunci internal (`timingSafeEqual`), MCP server dengan empat tool baca, `.mcp.json`, `CLAUDE.md`, `.claude/settings.json`.
**Selesai bila:** `pnpm infra:up` sehat; `pnpm db:migrate`, `pnpm typecheck`, `pnpm build`, `pnpm test` bersih; `/mcp` di Claude Code menampilkan `hostinger-ops` tersambung.

### M2 — Vault, login, dan uji kemampuan
`ops:secret:set`, `ops:login:add`; client Hostinger dengan batas waktu 30 detik, pembatas 90/menit per login, penanganan 429 + `Retry-After`, error tersaring; uji kemampuan baca-saja untuk dua login pilot.
**Selesai bila:** token dua login tersimpan terenkripsi; Claude menampilkan status koneksi dan daftar kemampuan keduanya; tiap panggilan tercatat di `AuditLog`; tidak ada token di log atau respons.

### M3 — Inventaris
Sinkronisasi login → paket → website dengan pagination, upsert, aturan 7.2; antrean di PostgreSQL; tool inventaris dan laporan kapasitas.
**Selesai bila:** semua website dua login pilot muncul dengan paket yang benar; sinkronisasi ulang tidak mengubah data bisnis; website yang hilang menjadi `UNKNOWN`.

### M4 — Migrasi WordPress
- **M4a — Pembuktian.** Tujuh butir di 3.3 diuji di akun pilot dengan skrip sekali pakai; hasilnya ditulis ke `docs/API-CAPABILITIES.md`. Rancangan langkah di 9.2 dan 9.3 disesuaikan dengan hasilnya sebelum kode ditulis; perubahan yang mengubah alur dikonfirmasi ke pemilik.
- **M4b — Tahap A.** Gelombang, pekerjaan, langkah, cadangan, laporan. **Uji coba pertama berhenti di sini** (pilihan pemilik): salin ke dummy tanpa hapus sumber dan tanpa DNS.
  **Selesai bila:** satu gelombang kecil menghasilkan salinan dummy yang lolos uji; worker yang dimatikan di tengah jalan melanjutkan dari langkah terakhir; laporan tertulis tanpa kredensial.
- **M4c — Approval dan Tahap B.** `ops:approve`, `ops:reject`, `OperationLock`, cutover.
  **Selesai bila:** eksekusi tanpa approval ditolak; approval kedaluwarsa, sudah terpakai, atau tidak cocok ditolak; `ops:approve` menolak input non-interaktif; satu website percobaan berpindah ujung ke ujung; kegagalan yang disengaja setelah `SOURCE_REMOVE` berakhir di `NEEDS_OPERATOR` dan bisa dilanjutkan.

### M5 — Memori klien dan proyek, lima skill
### M6 — Provisioning dan DNS umum
### M7 — Migrasi Laravel / PHP lain
### M8 — Monitoring, cadangan pusat, impor massal login

M5–M8 dirinci menjadi rencana kerja sendiri-sendiri ketika gilirannya tiba.

---

## 13. Diserahkan ke builder

- Nama kolom, indeks, dan relasi Prisma di luar syarat 7.1.
- Pustaka antrean PostgreSQL dan pustaka SSH.
- Bentuk route API internal dan skema Zod.
- Jumlah percobaan ulang dan jeda antar percobaan.
- Format tepat `approvalId` dan isi `payloadHash`.
- Isi kelima `SKILL.md`, selama tidak menjadikan instruksi sebagai pengganti pemeriksaan backend.
- Ambang ruang disk bawaan.

## 14. Keputusan penulis (bukan dari pemilik — mohon diperiksa)

1. Hierarki tiga tingkat Login → Paket → Website; `principalGroup` dihapus.
2. Paket ditemukan otomatis dari token; perintah `ops:account:add` dari PRD v1 diganti `ops:login:add`.
3. Tahap A berjalan 3 website sekaligus; Tahap B satu per satu.
4. Masa berlaku approval gelombang 60 menit.
5. `PRE_DELETE_CHECK` ditambahkan sebelum menghapus sumber.
6. Record MX dan TXT tidak pernah disentuh saat cutover.
7. Cloudflare, VPS, dan Cloud Hosting dikeluarkan dari versi 1.
8. M4a (pembuktian di akun pilot) dijadikan syarat sebelum kode migrasi ditulis.
9. Laporan gelombang ditulis sebagai file selain dikembalikan ke Claude.
10. Fallback token dari `.env` hanya saat `NODE_ENV=development`.
11. Paket baru `ssh-adapter` dipisah dari `hostinger-adapter`.
12. Approval gelombang tetap berlaku untuk daftarnya sampai selesai; lanjut sebelum `SOURCE_REMOVE` butuh approval baru, sesudahnya tidak.
13. Bila zone DNS ter-reset, record dikembalikan persis seperti snapshot di bawah approval gelombang yang sama.
14. `SOURCE_REMOVE` tidak menghapus database sumber.
15. Uji M4a dan M4c yang menghapus atau mengubah sesuatu hanya dijalankan pada website dan domain yang disebut pemilik secara eksplisit saat tahap itu tiba; builder tidak memilih sendiri.
