# Keamanan

## Batas yang dijaga kode

- API hanya mendengarkan di `127.0.0.1`. Semua route selain `/health` butuh header `x-api-key`; perbandingan memakai `timingSafeEqual` atas hash SHA-256 sehingga panjang kunci tidak bocor dan tidak memicu error.
- Respons API disusun lewat skema Zod; kolom di luar skema (misal `tokenRef`) tidak pernah terkirim. Error tak terduga dibalas `{"error":"internal_error"}`, detailnya hanya di log server.
- MCP server membaca `.env` hanya untuk mengambil `HOSTING_OPS_API_KEY` dan `API_PORT`; nilai lain dibuang. Log ditulis ke stderr.
- Rahasia di `secret_vaults` dienkripsi AES-256-GCM dengan IV acak 12 byte; `authTag` yang diubah membuat dekripsi gagal.
- Tabel `audit_logs` hanya-tambah: trigger database menolak `UPDATE` dan `DELETE`.
- Hook `.githooks/commit-msg` menolak atribusi AI di pesan commit.
- Token Hostinger masuk hanya lewat prompt tersembunyi `ops:secret:set` / `ops:login:add`. Keduanya menolak stdin yang bukan terminal interaktif (di-pipe, atau `!` di Claude Code), dan menolak nilai berisi spasi atau karakter tak terlihat.
- Token didekripsi hanya di proses API saat verifikasi. Audit per panggilan Hostinger hanya menyimpan path, status, nomor percobaan, dan durasi. Error dari `fetch` tidak pernah diteruskan karena pesannya bisa memuat detail request.
- Uji koneksi berhenti setelah satu probe kena rate limit, supaya tidak memperparah pembatasan (PRD §3.2: pelanggaran berulang bisa memblokir IP).
- **RDAP (PRD §7.3):** satu-satunya layanan luar selain Hostinger. Yang dikirim hanya nama domain, setelah lolos `isPlainHostname` dan di-encode sebelum masuk URL. Alamat server diambil dari bootstrap IANA dan hanya yang `https://` dipakai. Pengecekan massal dibatasi satu domain per detik. Audit: `RDAP_LOOKUP` per permintaan dan `DOMAIN_EXPIRY_CHECK` per domain.

## Tampilan web

- **Password:** satu pengguna, dibuat lewat `ops:ui:password` (terminal interaktif saja). Disimpan sebagai hash scrypt (N=16384, r=8, p=1, salt 16 byte) di `ui_credentials`, dibandingkan dengan `timingSafeEqual`.
- **Sesi:**
  - token acak 32 byte; yang disimpan hanya SHA-256-nya, di memori proses;
  - cookie `ops_session` dengan `HttpOnly; SameSite=Strict; Path=/`;
  - berakhir setelah 8 jam tidak aktif, saat API dinyalakan ulang, atau saat password diganti (sesi yang dibuat sebelum `ui_credentials.updatedAt` ditolak).
- **Batas percobaan:** setiap percobaan dihitung sebelum hash diperiksa, sehingga tebakan paralel tidak bisa lolos. 5 percobaan dalam 15 menit mengunci login selama 5 menit.
- **Pemisahan dari jalur Claude:** pintu dipilih dari route yang dicocokkan router, sehingga URL berkode seperti `/%76%31/logins` tetap memerlukan `x-api-key`.
- **DNS rebinding:** rute web menolak header `Host` selain `127.0.0.1` dan `localhost` (421).
- **CSRF:** setiap `POST` web wajib `Sec-Fetch-Site: same-origin`, atau `Origin` yang persis `http://<Host>`, port termasuk. Situs lokal lain (misal Laragon di `localhost:80`) dianggap "same-site" oleh browser, jadi `SameSite=Strict` saja tidak cukup.
- **Header:** CSP `default-src 'self'`, jadi skrip hanya `/assets/app.js` milik sendiri (loader, kunci tombol, tombol Kembali; tanpa skrip semua form tetap jalan) dan tidak ada skrip inline. Juga `frame-ancestors 'none'`, `Cache-Control: no-store`, `Referrer-Policy: same-origin`, `nosniff`.
- **Escape:** semua nilai dari Hostinger dan dari pengguna di-escape oleh `html\`\``. Pencarian domain meng-escape `%` dan `_`, karena `contains` Prisma tidak melakukannya.
- **Pengalihan:** `kembali` hanya menerima path internal (`/…`, bukan `//` atau `/\`).
- **Audit:** login web (`UI_LOGIN`), pembuatan password (`UI_PASSWORD_SET`), permintaan sinkron (`SYNC_REQUEST`), uji koneksi, cek tanggal kedaluwarsa (`DOMAIN_EXPIRY_CHECK`), dan permintaan cek massal (`DOMAIN_EXPIRY_REQUEST`) dicatat dengan pelaku `WEB_HUMAN` atau `CLI_HUMAN`, terpisah dari `CLAUDE_MCP`.

**Risiko yang diterima:** HTTP lokal tanpa TLS (hanya `127.0.0.1`), dan program lain milik pengguna yang sama di PC ini bisa mencoba menebak password, dibatasi oleh pembatas percobaan.

## Risiko yang diterima pemilik (PRD §8.3, "kunci sedang")

Claude Code berjalan di PC yang sama dengan akses terminal. Aturan deny di `.claude/settings.json` (membaca `.env`, menjalankan `ops:approve`, `ops:reject`, `ops:secret:*`) mempersulit, tetapi bukan batas keamanan mutlak: proses mana pun milik pengguna yang sama bisa membaca `.env`, termasuk `SECRETS_MASTER_KEY`.

Peningkatan yang tersedia nanti: kunci utama di Windows Credential Manager dan passphrase pada perintah approve.

## Catatan

- Nama kunci `attribution` di `.claude/settings.json` belum dikonfirmasi dari dokumentasi Claude Code; hook `commit-msg` tetap menjadi penjaga utama.
