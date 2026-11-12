import { createDb, type PrismaClient } from "@ops/database";
import { parseMasterKey } from "@ops/shared";
import { loadRootEnv } from "../env-file.js";

export async function runCli(main: (db: PrismaClient, masterKey: Buffer) => Promise<string>): Promise<void> {
  loadRootEnv();
  let db: PrismaClient | undefined;
  try {
    const masterKey = parseMasterKey(process.env.SECRETS_MASTER_KEY);
    db = createDb();
    process.stdout.write(`${await main(db, masterKey)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
