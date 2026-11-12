import { createTestDb } from "@ops/database/test-db";
import { decryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test } from "vitest";
import { addLogin, defaultTokenRef } from "./logins.js";
import { hasSecret, storeSecret } from "./secrets.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
afterAll(() => db.$disconnect());

test("stores a trimmed value encrypted and audits without the value", async () => {
  expect(await storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "  tok-abc \r\n" })).toBe("created");
  const row = await db.secretVault.findUniqueOrThrow({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } });
  expect(row.cipherText).not.toContain("tok-abc");
  expect(decryptSecret(row, key)).toBe("tok-abc");
  const audit = await db.auditLog.findMany();
  expect(audit).toMatchObject([{ actor: "CLI_HUMAN", action: "SECRET_SET", resourceId: "HOSTINGER_TOKEN_SUMBER", result: "created" }]);
  expect(JSON.stringify(audit)).not.toContain("tok-abc");
  expect(await hasSecret(db, "HOSTINGER_TOKEN_SUMBER")).toBe(true);
  expect(await hasSecret(db, "HOSTINGER_TOKEN_TIDAK_ADA")).toBe(false);
});

test("second store rotates the secret", async () => {
  expect(await storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "tok-new" })).toBe("rotated");
  const row = await db.secretVault.findUniqueOrThrow({ where: { refKey: "HOSTINGER_TOKEN_SUMBER" } });
  expect(row.rotatedAt).not.toBeNull();
  expect(decryptSecret(row, key)).toBe("tok-new");
});

test.each(["", "   \n"])("rejects value %j", async (value) => {
  await expect(storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_X", value })).rejects.toThrow("Secret value is empty");
});

test("rejects a malformed refKey", async () => {
  await expect(storeSecret(db, key, { refKey: "bad key", value: "x" })).rejects.toThrow();
});

test("adds a login, refuses a duplicate or malformed alias", async () => {
  await addLogin(db, { alias: "sumber", tokenRef: defaultTokenRef("sumber") });
  expect((await db.hostingerLogin.findUniqueOrThrow({ where: { alias: "sumber" } })).tokenRef).toBe("HOSTINGER_TOKEN_SUMBER");
  expect(await db.auditLog.count({ where: { action: "LOGIN_ADD", resourceId: "sumber" } })).toBe(1);
  await expect(addLogin(db, { alias: "sumber", tokenRef: "X" })).rejects.toThrow('Login "sumber" already exists');
  await expect(addLogin(db, { alias: "Sumber Utama", tokenRef: "X" })).rejects.toThrow(
    "Alias must be lowercase letters, digits, or dashes",
  );
});

test("defaultTokenRef turns dashes into underscores", () => {
  expect(defaultTokenRef("akun-dua")).toBe("HOSTINGER_TOKEN_AKUN_DUA");
});

test.each(["tok\u001b[Dabc", "tok\u0004abc", "tok\u001aabc", "tok abc"])("rejects a value with spaces or invisible characters %j", async (value) => {
  await expect(storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_X", value })).rejects.toThrow(
    "Secret contains spaces or invisible characters; type or paste it again",
  );
});
