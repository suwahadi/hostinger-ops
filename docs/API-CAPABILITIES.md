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

## Dari spesifikasi OpenAPI resmi (dicek 12 November 2026)

- `GET /api/hosting/v1/websites`: parameter `page`, `per_page`, `username`, `order_id`, `is_enabled`, `domain_filter`, `hosting_website_types`; respons `{ data, meta: { current_page, per_page, total } }`.
- `GET /api/hosting/v1/orders`: parameter `page`, `per_page`, `statuses`, `order_ids`; respons `{ data, meta }`.
- `GET /api/domains/v1/portfolio`: tanpa parameter; respons berupa array item `{ id, domain, type, status, created_at, expires_at, verification }`.
- `GET /api/dns/v1/zones/{domain}`: respons berupa array record.

## Belum terbukti (PRD §3.3, dikerjakan di M4a)

Delapan butir perilaku yang menentukan alur migrasi, antara lain: satu domain di dua login, mengganti domain utama website, impor WordPress lewat API, dan nasib DNS zone saat website dipindah.
