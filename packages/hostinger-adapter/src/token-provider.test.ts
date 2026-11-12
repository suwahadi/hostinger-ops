import { createTestDb } from "@ops/database/test-db";
import { encryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test } from "vitest";
import { createTokenProvider } from "./token-provider.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
afterAll(() => db.$disconnect());

test("decrypts a stored token and stamps lastUsedAt", async () => {
  await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret("tok-1", key) } });
  expect(await createTokenProvider({ db, masterKey: key, env: {} }).getToken("HOSTINGER_TOKEN_SUMBER")).toBe("tok-1");
  expect((await db.secretVault.findUnique({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } }))?.lastUsedAt).not.toBeNull();
});

test("falls back to env only in development", async () => {
  const env = { HOSTINGER_TOKEN_TUJUAN: "tok-env" };
  const dev = createTokenProvider({ db, masterKey: key, env: { ...env, NODE_ENV: "development" } });
  expect(await dev.getToken("HOSTINGER_TOKEN_TUJUAN")).toBe("tok-env");
  const prod = createTokenProvider({ db, masterKey: key, env: { ...env, NODE_ENV: "production" } });
  await expect(prod.getToken("HOSTINGER_TOKEN_TUJUAN")).rejects.toMatchObject({
    reason: "missing",
    message: "No secret stored for HOSTINGER_TOKEN_TUJUAN",
  });
});

test("reports a secret encrypted with another master key as unreadable", async () => {
  await db.secretVault.create({
    data: { refKey: "HOSTINGER_TOKEN_LAMA", ...encryptSecret("tok-2", parseMasterKey("cd".repeat(32))) },
  });
  await expect(createTokenProvider({ db, masterKey: key, env: {} }).getToken("HOSTINGER_TOKEN_LAMA")).rejects.toMatchObject({
    reason: "unreadable",
    message: "Secret HOSTINGER_TOKEN_LAMA cannot be decrypted with the current SECRETS_MASTER_KEY",
  });
});
