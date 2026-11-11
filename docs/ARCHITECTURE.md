# Arsitektur (keadaan M1)

```text
Claude Code ──stdio──▶ apps/mcp-server ──HTTP + x-api-key──▶ apps/api ──Prisma──▶ PostgreSQL 17 (Docker)
                        4 tool baca          127.0.0.1:3000                       127.0.0.1:${OPS_PG_PORT}
```

| Bagian | Isi |
| :--- | :--- |
| `packages/shared` | AES-256-GCM (`encryptSecret`, `decryptSecret`, `parseMasterKey`) dan skema Zod respons API |
| `packages/database` | Skema Prisma lengkap (PRD §7.1), migrasi, `createDb`, `createTestDb` |
| `apps/api` | Fastify. `/health` tanpa kunci; `/v1/logins`, `/v1/accounts`, `/v1/websites`, `/v1/logins/:alias/capabilities` dengan kunci internal |
| `apps/mcp-server` | `list_logins`, `list_accounts`, `list_websites`, `get_login_capabilities`; hanya memanggil API lokal |

Belum ada: worker, antrean, adapter Hostinger dan SSH, perintah `ops:*` (M2–M4).

## Menjalankan

```bash
corepack pnpm install
corepack pnpm infra:up      # PostgreSQL
corepack pnpm db:migrate
corepack pnpm build         # MCP server dijalankan Claude Code dari dist/
corepack pnpm dev:api       # biarkan berjalan selama memakai Claude Code
```

`corepack pnpm` bisa diganti `pnpm` bila pnpm terpasang global. Test (`pnpm test`) memakai database terpisah `hostinger_ops_test` di container yang sama dan mengosongkannya setiap kali dijalankan.
