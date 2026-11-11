import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

export function testDatabaseUrl(baseUrl = process.env.DATABASE_URL): string {
  if (!baseUrl) throw new Error("DATABASE_URL is not set");
  const url = new URL(baseUrl);
  url.pathname = "/hostinger_ops_test";
  return url.toString();
}

export async function createTestDb(): Promise<PrismaClient> {
  const url = testDatabaseUrl();
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const db = new PrismaClient({ datasourceUrl: url });
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    // TRUNCATE skips the row-level append-only trigger on audit_logs, which DELETE would hit.
    await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  return db;
}
