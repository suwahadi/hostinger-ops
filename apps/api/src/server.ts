import { createDb } from "@ops/database";
import { createRateLimiter, HOSTINGER_RATE_LIMIT } from "@ops/hostinger-adapter";
import { startWorker, syncLoginInventory } from "@ops/worker";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadRootEnv } from "./env-file.js";

loadRootEnv();
const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
// One limiter for the routes and the worker, so a login never exceeds 90 requests per minute in total.
const limiter = createRateLimiter(HOSTINGER_RATE_LIMIT);
const app = buildApp({ db, apiKey: config.apiKey, masterKey: config.masterKey, limiter, logger: true });
await app.listen({ host: "127.0.0.1", port: config.port });

const worker = startWorker({
  db,
  handlers: { "sync-login": (job) => syncLoginInventory({ db, masterKey: config.masterKey, limiter }, job) },
  log: (message) => app.log.info(message),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await worker.stop();
    await app.close();
    await db.$disconnect();
    process.exit(0);
  });
}
