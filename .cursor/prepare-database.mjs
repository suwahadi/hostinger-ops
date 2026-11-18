import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const placeholders = new Set(["change-me", "at-least-32-random-characters", "64-hex-characters"]);

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    out[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return out;
}

function readEnvFile() {
  try {
    return parseEnv(readFileSync(".env", "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function usable(value, check) {
  return Boolean(value) && !placeholders.has(value) && check(value);
}

function randomHex(bytes) {
  const generated = spawnSync("openssl", ["rand", "-hex", String(bytes)], { encoding: "utf8" });
  if (generated.status !== 0) {
    console.error("openssl rand failed");
    process.exit(1);
  }
  return generated.stdout.trim();
}

function psql(sql) {
  const result = spawnSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-f", "-"], {
    input: sql,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error("psql failed");
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function migrate(databaseUrl, password) {
  const result = spawnSync("corepack", ["pnpm", "--filter", "@ops/database", "migrate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const redacted = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replaceAll(databaseUrl, "[redacted-database-url]").replaceAll(password, "[redacted]");
    console.error(redacted);
    process.exit(result.status ?? 1);
  }
}

const fromProcess = process.env;
const fromFile = readEnvFile();
const pick = (name) => fromProcess[name] || fromFile[name] || "";

let password = pick("POSTGRES_PASSWORD");
let apiKey = pick("HOSTING_OPS_API_KEY");
let masterKey = pick("SECRETS_MASTER_KEY");
const port = pick("OPS_PG_PORT") || "5432";
const apiPort = pick("API_PORT") || "3000";

const passwordOk = usable(password, (value) => value.length >= 16 && !/[\s"'\\]/.test(value));
const apiKeyOk = usable(apiKey, (value) => value.length >= 32 && !/[\s"'\\]/.test(value));
const masterKeyOk = usable(masterKey, (value) => /^[0-9a-fA-F]{64}$/.test(value));

let databaseUrl = pick("DATABASE_URL");
const databaseUrlOk = databaseUrl.startsWith("postgresql://") && !databaseUrl.includes("change-me") && !/[\s"'\\]/.test(databaseUrl);

if (!passwordOk || !apiKeyOk || !masterKeyOk) {
  password = randomHex(24);
  apiKey = randomHex(32);
  masterKey = randomHex(32);
  databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/hostinger_ops`;
  console.log("Wrote throwaway local secrets to .env");
} else if (!databaseUrlOk) {
  databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/hostinger_ops`;
  console.log("Using existing environment secrets");
} else {
  console.log("Using existing environment secrets");
}
writeFileSync(
  ".env",
  [
    "NODE_ENV=development",
    `POSTGRES_PASSWORD=${password}`,
    `OPS_PG_PORT=${port}`,
    `DATABASE_URL=${databaseUrl}`,
    `HOSTING_OPS_API_KEY=${apiKey}`,
    `SECRETS_MASTER_KEY=${masterKey}`,
    `API_PORT=${apiPort}`,
    "",
  ].join("\n"),
  { mode: 0o600 },
);

const escapedPassword = password.replaceAll("'", "''");
psql(`ALTER USER postgres WITH PASSWORD '${escapedPassword}';`);

for (const name of ["hostinger_ops", "hostinger_ops_test"]) {
  const exists = psql(`SELECT 1 FROM pg_database WHERE datname = '${name}';`);
  if (exists !== "1") {
    const created = spawnSync("sudo", ["-u", "postgres", "createdb", name], { encoding: "utf8" });
    if (created.status !== 0) {
      console.error(`Could not create database ${name}`);
      process.exit(created.status ?? 1);
    }
  }
}

migrate(databaseUrl, password);
const testUrl = new URL(databaseUrl);
testUrl.pathname = "/hostinger_ops_test";
migrate(testUrl.toString(), password);
console.log("Migrations applied to hostinger_ops and hostinger_ops_test");
