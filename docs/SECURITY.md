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

## Risiko yang diterima pemilik (PRD §8.3, "kunci sedang")

Claude Code berjalan di PC yang sama dengan akses terminal. Aturan deny di `.claude/settings.json` (membaca `.env`, menjalankan `ops:approve`, `ops:reject`, `ops:secret:*`) mempersulit, tetapi bukan batas keamanan mutlak: proses mana pun milik pengguna yang sama bisa membaca `.env`, termasuk `SECRETS_MASTER_KEY`.

Peningkatan yang tersedia nanti: kunci utama di Windows Credential Manager dan passphrase pada perintah approve.

## Catatan

- Nama kunci `attribution` di `.claude/settings.json` belum dikonfirmasi dari dokumentasi Claude Code; hook `commit-msg` tetap menjadi penjaga utama.
