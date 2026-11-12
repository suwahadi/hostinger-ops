# Desain: Tampilan Web Hostinger Ops

| | |
| :--- | :--- |
| Tanggal | 12 November 2026 |
| Status | Draf (sudah dibaca reviewer), menunggu persetujuan pemilik |
| Menyimpang dari | PRD §2.2 ("Dashboard web" adalah bukan-sasaran v1). Pemilik memintanya pada 12 Nov 2026. |

## 1. Untuk apa

Pemilik ingin melihat kondisi semua akun Hostinger sekilas dari browser tanpa harus bertanya lewat Claude:
- paket yang mau habis,
- kapasitas per paket,
- pencarian website,
- apakah sinkronisasi berjalan.

Pemakainya satu orang, dari PC ini, di `http://127.0.0.1:3000/`. "Sederhana tapi informatif": empat halaman, tabel yang bisa dibaca cepat, tanpa grafik.

## 2. Sasaran, bukan sasaran, pantangan

**Sasaran**
1. Login dengan password yang dibuat pemilik dari terminal.
2. Empat halaman: Ringkasan, Paket, Website, Sinkron & Audit (menu samping).
3. Dua tombol aksi yang hanya membaca dari Hostinger: **Sinkronkan** (semua login atau satu login) dan **Uji koneksi** (satu login).

**Bukan sasaran**
- Akses dari HP atau jaringan lokal; tetap `127.0.0.1`.
- Banyak pengguna atau peran.
- Grafik.
- Mengedit data (klien, proyek, catatan).
- Aksi yang mengubah atau menghapus apa pun di Hostinger.
- Framework frontend, proses build frontend, atau dependensi npm baru.

**Pantangan (gagal walaupun jalan)**
- Kunci API internal (`HOSTING_OPS_API_KEY`), token Hostinger, atau isi vault sampai ke browser.
- Cookie sesi web bisa dipakai untuk memanggil `/v1/*` (jalur Claude), atau sebaliknya.
- Data dari Hostinger (domain, nama paket) bisa menyisipkan HTML atau skrip ke halaman.
- Aksi dari browser tercatat di audit sebagai perbuatan Claude.

## 3. Yang diputuskan pemilik

| Hal | Keputusan |
| :--- | :--- |
| Aksi | Lihat + tombol aman (Sinkronkan, Uji koneksi) |
| Isi | Ringkasan & paket mau habis; paket per login; cari website; status sinkron & audit |
| Login | Password dibuat lewat terminal, disimpan sebagai hash; satu pengguna |
| Susunan | Menu samping, empat halaman terpisah |
| Akses | Hanya dari PC ini |
| Gaya | Aturan antislop (UI, copy, aksesibilitas) diterapkan **selama** pengerjaan |

## 4. Rancangan

### 4.1 Penyajian

- Halaman HTML dirender di server oleh Fastify yang sudah ada (`apps/api`), sehingga tetap satu proses dan satu perintah `corepack pnpm dev:api`.
- Satu file CSS di `/assets/app.css`. **Tidak ada JavaScript** di halaman. Semua interaksi memakai link biasa dan form `GET`/`POST`, sehingga CSP bisa ketat.
- Bahasa tampilan: Indonesia.
- Waktu: format `id-ID` dalam zona waktu PC. Tanggal habis juga ditampilkan relatif ("3 hari lagi", "lewat 2 hari").
- Semua nilai dinamis melewati satu fungsi escape HTML. Tidak ada jalur yang menyisipkan string mentah.

### 4.2 Rute

| Rute | Akses | Isi |
| :--- | :--- | :--- |
| `GET /` | sesi | Ke `/ringkasan`; tanpa sesi ke `/login` |
| `GET /login`, `POST /login` | publik | Form password. Bila password belum dibuat, tampilkan cara membuatnya |
| `POST /logout` | sesi | Hapus sesi, ke `/login` |
| `GET /ringkasan` | sesi | 4 angka (login, paket, website, WordPress; aturan hitung di §4.2a); tabel habis ≤30 hari atau sudah lewat; tabel status login dengan tombol |
| `GET /paket?login=&urut=` | sesi | Semua paket non-`UNKNOWN`. Saringan login; urutan `habis` (bawaan) / `website` / `kode`. Kolom: kode order, username, paket, status, website, habis, auto-renew, pemilik, dibagi ke. Jumlah paket `UNKNOWN` disebut di bawah tabel |
| `GET /website?q=&login=&jenis=&status=&hal=` | sesi | Cari sebagian domain (tidak peka huruf besar), saringan, 50 baris per halaman. Tanpa saringan status, website `UNKNOWN` tidak ditampilkan; saringan status bisa memilih `UNKNOWN`. Kolom: domain, jenis, status, username, login pemilik, folder web |
| `GET /website/:domain` | sesi | Detail satu domain (semua baris bila ada di beberapa login), termasuk `metadata.provider` |
| `GET /sinkron?login=&api=1` | sesi | Status per login; 30 job terakhir (jenis, login, status, percobaan, mulai, selesai, ringkasan hasil atau error); 50 baris audit terakhir (waktu, pelaku, aksi, sumber, hasil). Baris `HOSTINGER_API_CALL` disembunyikan kecuali `api=1`, karena satu sinkronisasi menulis belasan baris yang akan menenggelamkan baris lain (*keputusan penulis*) |
| `POST /aksi/sinkron` | sesi | Field `login` opsional → antrekan job `sync-login` (dedupe seperti `/v1/sync`) → kembali ke halaman asal dengan pesan |
| `POST /aksi/uji` | sesi | Field `login` wajib → `verifyLogin` → kembali dengan pesan status dan `hint` |
| `GET /assets/app.css` | publik | CSS |
| `/v1/*`, `/health` | tidak berubah | Jalur Claude tetap memakai `x-api-key`; cookie sesi tidak berlaku di sini |

Pesan sesudah aksi dibawa lewat query string (`?pesan=…`), di-escape saat ditampilkan, dan tidak pernah memuat token.

### 4.2a Aturan hitung (*keputusan penulis*)

Satu aturan untuk semua angka di halaman Ringkasan, supaya angkanya tidak saling bertentangan saat pemilik mencocokkannya dengan hPanel:
- **Paket:** paket yang statusnya bukan `UNKNOWN`.
- **Website dan WordPress:** dihitung dari baris `websites` yang statusnya bukan `UNKNOWN` dan paketnya bukan `UNKNOWN`. WordPress = himpunan yang sama dengan `websiteType = WORDPRESS`.
- Setiap paket hanya dihitung sekali, walaupun bisa diakses dari beberapa login.

`/v1/capacity` memakai aturan yang sama. Logikanya dipindah ke satu layanan bersama, dan totalnya dihitung dari baris website, bukan dari `websiteCount`, supaya web dan Claude selalu menunjukkan angka yang sama.

### 4.3 Password dan sesi

- **Tabel baru `ui_credentials`:** satu baris dengan `id = 1`, `passwordHash`, `updatedAt`. Hash memakai `crypto.scrypt` bawaan Node dengan salt acak 16 byte. Format dan parameternya disimpan bersama hash agar bisa dinaikkan nanti. Perbandingan memakai `timingSafeEqual`.
- **Perintah baru `corepack pnpm ops:ui:password`:**
  - memakai `runCli`, `assertInteractive`, dan `readHidden` yang sudah ada;
  - meminta password dua kali; minimal 12 karakter; boleh mengandung spasi;
  - menulis audit `UI_PASSWORD_SET` dengan pelaku `CLI_HUMAN`;
  - ditambahkan ke aturan deny di `.claude/settings.json`.
- **Sesi di memori proses:**
  - token acak 32 byte; yang disimpan hanya SHA-256-nya;
  - cookie `ops_session`: `HttpOnly`, `SameSite=Strict`, `Path=/`, tanpa `Secure` karena HTTP lokal;
  - berakhir setelah 8 jam tidak aktif;
  - menyalakan ulang API mengakhiri semua sesi (diterima: satu pengguna, PC lokal).
- **Batas percobaan:** 5 password salah dalam 15 menit mengunci login selama 5 menit; disimpan di memori.
- **CSRF** (*keputusan penulis*): cookie `SameSite=Strict`, ditambah setiap `POST` di luar `/v1` wajib lolos salah satu:
  - `Sec-Fetch-Site: same-origin`, atau
  - header `Origin` berhost `127.0.0.1:<port>` atau `localhost:<port>`.

  Selain itu → 403.
- **Kembali ke halaman asal sesudah aksi** lewat field tersembunyi `kembali`. Hanya path internal yang diterima: diawali `/`, bukan `//`, dan tanpa skema. Selain itu ke `/ringkasan`, supaya field ini tidak bisa dipakai untuk mengalihkan ke situs lain.
- **Header untuk semua halaman web:**
  - `Content-Security-Policy: default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;
  - `Cache-Control: no-store`;
  - `Referrer-Policy: same-origin` (*keputusan penulis*). Dengan `no-referrer`, browser mengirim `Origin: null` pada `POST` form, sehingga pemeriksaan CSRF di atas menolak semua form, termasuk login.
  - `X-Content-Type-Options: nosniff`.
- **Ganti password mengakhiri sesi lama** (*keputusan penulis*): setiap request web membandingkan waktu sesi dibuat dengan `ui_credentials.updatedAt` (satu baca database lokal per request). Sesi yang dibuat sebelum password diganti dianggap berakhir.

### 4.4 Pembagian autentikasi di `app.ts`

Hook `onRequest` yang sekarang mewajibkan `x-api-key` untuk semua rute selain `/health` dipecah:
- `/health`: bebas.
- `/v1/*`: wajib `x-api-key`, seperti sekarang. Cookie sesi diabaikan.
- `/login`, `/assets/*`: bebas.
- Selain itu: wajib sesi. Tanpa sesi, `GET` dialihkan ke `/login` dan `POST` dibalas 401.

### 4.5 Audit

- Nilai enum baru `AuditActor.WEB_HUMAN`.
- `verifyLogin` menerima parameter `actor`. Bawaan `CLAUDE_MCP` agar perilaku jalur Claude tidak berubah; dari web `WEB_HUMAN`.
- Setiap permintaan sinkronisasi menulis satu baris `SYNC_REQUEST` (resource `hostinger_login`, resourceId alias, result `queued` atau `already_queued`), baik dari web (`WEB_HUMAN`) maupun dari `POST /v1/sync` (`CLAUDE_MCP`). Ini sekaligus menutup temuan kecil M3 bahwa `POST /v1/sync` tidak tercatat di audit.
- Login web berhasil, gagal, dan terkunci dicatat: `UI_LOGIN` dengan result `ok`, `wrong_password`, atau `locked`, pelaku `WEB_HUMAN`. Password tidak pernah dicatat.

### 4.6 Tampilan

- Menu samping kiri: Ringkasan, Paket, Website, Sinkron & Audit, lalu Keluar di bawah. Halaman aktif ditandai.
- Lebar layar PC adalah sasaran utama. Di layar sempit, menu samping pindah ke atas dan tabel bisa digulir mendatar di dalam wadahnya.
- Penekanan warna hanya untuk informasi:
  - tanggal habis yang sudah lewat atau ≤7 hari;
  - status login selain `CONNECTED`;
  - job `FAILED`.

  Warna tidak pernah menjadi satu-satunya penanda; selalu ada teks.
- Tombol aksi berupa form `POST`, dengan label yang menjelaskan hasilnya ("Sinkronkan semua login", "Uji koneksi").
- Detail visual (palet, tipografi, jarak) diserahkan ke pembangun, mengikuti aturan antislop: kontras cukup, fokus keyboard terlihat, tidak memakai pola template generik.

## 5. Batasan teknis

- Tidak ada dependensi baru.
  - Cookie diurai dari header secara manual (beberapa baris).
  - Form `application/x-www-form-urlencoded` diurai lewat content-type parser Fastify dengan `URLSearchParams`.
- Data diambil lewat Prisma dan layanan yang sudah ada (`loginSummaries`, `toAccountSummary`, `accessibleBy`, `enqueueJob`, `verifyLogin`). Tidak ada query ganda untuk hal yang sudah dihitung `/v1/capacity`; logika kapasitas dipindah ke layanan bersama bila perlu.
- Migrasi: tabel `ui_credentials` dan nilai enum `WEB_HUMAN`. API harus dimatikan sebelum `prisma generate` (lihat `MEMORY.md`).
- Pemeriksaan sebelum commit seperti biasa: `typecheck`, `test`, `build`.

## 6. Yang harus dibuktikan oleh test

1. Tanpa sesi: `GET /ringkasan` dialihkan ke `/login`; `POST /aksi/sinkron` → 401.
2. Password benar → cookie terpasang dan halaman terbuka. Password salah → tetap di `/login` dengan pesan. Percobaan ke-6 dalam 15 menit → terkunci.
3. Cookie sesi tidak membuka `/v1/logins`; `x-api-key` tidak membuka `/ringkasan`.
4. `POST` dengan `Origin` situs lain, atau tanpa `Origin` dan tanpa `Sec-Fetch-Site: same-origin` → 403. `POST` dengan `Sec-Fetch-Site: same-origin` → diterima. Field `kembali` berisi `//situs-lain` atau `https://…` → dialihkan ke `/ringkasan`.
4a. Mengganti password lewat CLI mengakhiri sesi yang dibuat sebelumnya.
4b. Halaman Sinkron & Audit menyembunyikan `HOSTINGER_API_CALL` kecuali `api=1`.
4c. Angka Ringkasan tidak menghitung paket atau website `UNKNOWN`, dan sama dengan total `/v1/capacity`.
5. Domain atau nama paket berisi `<script>` tampil sebagai teks.
6. Setiap halaman memuat data kunci dari seed: angka ringkasan, paket habis, paket bersama dengan "dibagi ke", hasil pencarian dan paginasi, job gagal beserta error-nya.
7. Tombol Sinkronkan mengantrekan job, dan menekannya dua kali tidak menggandakan job. Tombol Uji koneksi menjalankan verifikasi dengan `fetch` palsu. Keduanya tercatat di audit sebagai `WEB_HUMAN`.
8. Sesi kedaluwarsa setelah 8 jam tidak aktif (jam palsu).
9. `ops:ui:password` menolak stdin non-interaktif, password berbeda di dua prompt, atau password kurang dari 12 karakter. Hash tidak memuat password aslinya.
10. Halaman web membawa header keamanan di §4.3.

## 7. Diserahkan ke pembangun

- Palet, tipografi, jarak, dan detail CSS (dalam aturan antislop).
- Struktur file template, misalnya `apps/api/src/web/`.
- Nama fungsi internal.
- Teks persis pesan dan label, selama jelas, berbahasa Indonesia, dan tidak memuat data rahasia.
