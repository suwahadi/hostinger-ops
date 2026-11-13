# Kemampuan Hostinger API yang sudah terbukti

Diperbarui otomatis di database oleh `verify_login_connection`; file ini mencatat hasil uji yang penting untuk perencanaan. Alias login dan domain sungguhan tidak ditulis di sini.

## Uji pilot M2 (12 November 2026)

Dua login pilot (A dan B), paket shared hosting. Semua request GET, tidak ada yang diubah di Hostinger.

| Kemampuan | Request | Login A | Login B |
| :--- | :--- | :--- | :--- |
| `hosting.orders.list` | `GET /api/hosting/v1/orders?per_page=1` | 200 | 200 |
| `hosting.websites.list` | `GET /api/hosting/v1/websites?per_page=1` | 200 | 200 |
| `domains.portfolio.list` | `GET /api/domains/v1/portfolio` | 200 | 200 |
| `dns.zone.read` | `GET /api/dns/v1/zones/<domain pertama di portfolio>` | 200 | 200 |

Status kedua login: `CONNECTED`. Delapan panggilan, delapan baris `HOSTINGER_API_CALL` di `audit_logs`, tanpa token.

## Sinkronisasi pilot M3 (12 November 2026)

| | Login A | Login B |
| :--- | ---: | ---: |
| Paket (order) yang terlihat | 38 | 23 |
| Website yang terlihat | 284 | 618 |
| Halaman website (`per_page=50`) | 6 | 13 |
| Langganan di daftar billing | 244 | 315 |

- **Paket bersama:** 7 paket (118 website) terlihat dari kedua login. Seluruh inventaris: 54 paket berbeda, 784 website. Billing ketujuh paket itu ada di login B, sehingga login B menjadi pemiliknya (`ownerSource: BILLING`).
- **Billing tidak lengkap per login:** 28 paket yang terlihat dari login A tidak punya langganan di billing login mana pun, sehingga tanggal kedaluwarsanya tidak diketahui (`ownerSource: FIRST_SEEN`). Dugaan: paket itu ditagihkan ke akun klien yang memberi akses ke login A. Pemilik belum memastikan.
- **Paginasi:** `per_page=50` dihormati, dan `meta.total` cocok dengan jumlah item.
- **Daftar order bawaan** memuat paket berstatus `suspended` (2 paket), jadi tidak hanya `active`. Paket `expired` belum teramati.
- **Jenis website (`website_type`):** `wordpress` 682, `other` 101, `nodejs` 1. Tidak ada website tanpa domain.
- **Stabilitas:** dua putaran sinkronisasi berturut-turut tidak mengubah satu pun paket, pemilik, akses, atau website.

## Dari spesifikasi OpenAPI resmi (dicek 12 November 2026)

- `GET /api/hosting/v1/websites`: parameter `page`, `per_page`, `username`, `order_id`, `is_enabled`, `domain_filter`, `hosting_website_types`; respons `{ data, meta: { current_page, per_page, total } }`.
- `GET /api/hosting/v1/orders`: parameter `page`, `per_page`, `statuses`, `order_ids`; respons `{ data, meta }`.
- `GET /api/domains/v1/portfolio`: tanpa parameter; respons berupa array item `{ id, domain, type, status, created_at, expires_at, verification }`.
- `GET /api/dns/v1/zones/{domain}`: respons berupa array record.
- `GET /api/billing/v1/subscriptions`: tanpa parameter; respons berupa array `{ id, status, expires_at, is_auto_renewed, … }`; hanya memuat langganan yang ditagihkan ke login itu sendiri.
- Pemakaian disk dan batas jumlah website tidak tersedia untuk shared hosting (hanya untuk Agency Hosting).
- (Dicek 13 November 2026) `GET /api/domains/v1/portfolio/{domain}/renewal`: `{ domain, status, expires_at, is_grace_period, grace_period_ends_at, is_redemption_period, redemption_period_ends_at, is_renewable }`, hanya untuk domain di akun login itu.
- (Dicek 13 November 2026) `website_type` di `GET /api/hosting/v1/websites` hanya `wordpress`, `builder`, `horizons`, `nodejs`, `other`; Laravel dan PHP lain masuk `other`.
- (Terbukti 13 November 2026, 7 website contoh Laravel milik pemilik, semuanya 200) `GET /api/hosting/v1/accounts/{username}/domains/{domain}/files?max_depth=1&max_items=500` mendaftar isi folder web; `…/files/content?path=index.php&max_lines=80` membaca isi file teks. Hostinger sendiri menolak symlink, file besar, dan file berisi rahasia. Pada ketujuh contoh, folder web berisi isi `public/` Laravel (aplikasinya di subfolder) dan `index.php` memuat `LARAVEL_START`.
- (Dicek 13 November 2026) Endpoint "WHOIS" di Hostinger API (`/api/domains/v1/whois…`) hanya mengelola profil kontak pemilik domain; tidak ada pencarian WHOIS atau RDAP untuk domain di luar akun. Untuk itu dipakai RDAP registry (PRD §7.3).

## Belum terbukti (PRD §3.3, dikerjakan di M4a)

Delapan butir perilaku yang menentukan alur migrasi, antara lain: satu domain di dua login, mengganti domain utama website, impor WordPress lewat API, dan nasib DNS zone saat website dipindah.
