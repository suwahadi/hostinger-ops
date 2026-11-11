import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@ops/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig(process.env);
const app = buildApp({ db: createDb(config.databaseUrl), apiKey: config.apiKey, logger: true });
await app.listen({ host: "127.0.0.1", port: config.port });
