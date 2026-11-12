import { afterAll, expect, test } from "vitest";
import { createTestDb } from "./test-db.js";

const db = await createTestDb();
afterAll(() => db.$disconnect());

test("website is unique per account and domain", async () => {
  const login = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
  const account = await db.hostingAccount.create({ data: { code: "A001", loginId: login.id } });
  await db.website.create({ data: { accountId: account.id, domain: "contoh.com" } });
  await expect(db.website.create({ data: { accountId: account.id, domain: "contoh.com" } })).rejects.toThrow();
});

test("audit log rows cannot be updated or deleted", async () => {
  const row = await db.auditLog.create({
    data: { requestId: "r1", actor: "CLI_HUMAN", action: "TEST", resource: "none", result: "OK" },
  });
  await expect(db.auditLog.update({ where: { id: row.id }, data: { result: "X" } })).rejects.toThrow();
  await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
});

test("secret vault refKey is unique", async () => {
  const data = { refKey: "K1", cipherText: "a", iv: "b", authTag: "c" };
  await db.secretVault.create({ data });
  await expect(db.secretVault.create({ data })).rejects.toThrow();
});

test("only one active job per dedupe key", async () => {
  await db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } });
  await expect(db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } })).rejects.toThrow();
  await db.job.updateMany({ where: { dedupeKey: "sync-login:x" }, data: { status: "DONE" } });
  await expect(db.job.create({ data: { kind: "sync-login", payload: {}, dedupeKey: "sync-login:x" } })).resolves.toBeTruthy();
});

test("ui credentials hold one row and WEB_HUMAN is a valid audit actor", async () => {
  await db.uiCredential.create({ data: { passwordHash: "x" } });
  await expect(db.uiCredential.create({ data: { passwordHash: "y" } })).rejects.toThrow();
  await expect(
    db.auditLog.create({ data: { requestId: "w", actor: "WEB_HUMAN", action: "T", resource: "r", result: "ok" } }),
  ).resolves.toBeTruthy();
});
