import { createDb } from "@ops/database";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadRootEnv } from "./env-file.js";

loadRootEnv();
const config = loadConfig(process.env);
const app = buildApp({ db: createDb(config.databaseUrl), apiKey: config.apiKey, masterKey: config.masterKey, logger: true });
await app.listen({ host: "127.0.0.1", port: config.port });
