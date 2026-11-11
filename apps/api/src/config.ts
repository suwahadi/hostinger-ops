import { parseMasterKey } from "@ops/shared";

export type ApiConfig = { apiKey: string; port: number; masterKey: Buffer; databaseUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const apiKey = env.HOSTING_OPS_API_KEY ?? "";
  if (apiKey.length < 32) throw new Error("HOSTING_OPS_API_KEY must be at least 32 characters");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return {
    apiKey,
    port: Number(env.API_PORT ?? 3000),
    masterKey: parseMasterKey(env.SECRETS_MASTER_KEY),
    databaseUrl: env.DATABASE_URL,
  };
}
