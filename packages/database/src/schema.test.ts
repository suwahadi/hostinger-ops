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
