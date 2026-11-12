# Arsitektur (keadaan M2)

```text
Claude Code ──stdio──▶ apps/mcp-server ──HTTP + x-api-key──▶ apps/api ──Prisma──▶ PostgreSQL 17 (Docker)
                        5 tool               127.0.0.1:3000        │               127.0.0.1:${OPS_PG_PORT}
                                                                   └──HTTPS + Bearer──▶ developers.hostinger.com
Terminal pemilik ──ops:secret:set / ops:login:add──▶ apps/api/dist/cli ──▶ PostgreSQL (vault terenkripsi)
```

| Bagian | Isi |
| :--- | :--- |
| `packages/shared` | AES-256-GCM (`encryptSecret`, `decryptSecret`, `parseMasterKey`) dan skema Zod respons API |
| `packages/database` | Skema Prisma lengkap (PRD §7.1), migrasi, `createDb`, `createTestDb` |
| `packages/hostinger-adapter` | Client Hostinger dengan pembatas 90/menit per login dan penanganan 429, penyedia token dari vault, 4 probe baca-saja |
| `apps/api` | Fastify. `/health` tanpa kunci; `/v1/logins`, `/v1/accounts`, `/v1/websites`, `/v1/logins/:alias/capabilities`, `POST /v1/logins/:alias/verify` dengan kunci internal. CLI pemilik di `src/cli` |
| `apps/mcp-server` | `list_logins`, `list_accounts`, `list_websites`, `get_login_capabilities`, `verify_login_connection`; hanya memanggil API lokal |

Belum ada: worker, antrean, sinkronisasi inventaris, adapter SSH, perintah approval (M3–M4).

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
