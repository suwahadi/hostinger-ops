import { createTestDb } from "@ops/database/test-db";
import { afterAll, expect, test } from "vitest";
import { getUiCredential, hashPassword, setUiPassword, verifyPassword } from "./ui-password.js";

const db = await createTestDb();
afterAll(() => db.$disconnect());

test("hash round-trips and hides the password", async () => {
  const stored = await hashPassword("kata sandi panjang 1");
  expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  expect(stored).not.toContain("kata sandi");
  expect(await verifyPassword("kata sandi panjang 1", stored)).toBe(true);
  expect(await verifyPassword("kata sandi panjang 2", stored)).toBe(false);
  expect(await verifyPassword("x", "bukan-format")).toBe(false);
});

test("two hashes of the same password differ", async () => {
  expect(await hashPassword("kata sandi panjang 1")).not.toBe(await hashPassword("kata sandi panjang 1"));
});

test("setUiPassword rejects short passwords and audits without the password", async () => {
  await expect(setUiPassword(db, "pendek")).rejects.toThrow("Password must be at least 12 characters");
  expect(await getUiCredential(db)).toBeNull();
  await setUiPassword(db, "kata sandi panjang 1");
  const credential = await getUiCredential(db);
  expect(await verifyPassword("kata sandi panjang 1", credential!.passwordHash)).toBe(true);
  const audit = await db.auditLog.findMany();
  expect(audit).toMatchObject([{ actor: "CLI_HUMAN", action: "UI_PASSWORD_SET", resource: "ui_credentials", result: "set" }]);
  expect(JSON.stringify(audit)).not.toContain("kata sandi");
});

test("setting it again replaces the single row and moves updatedAt forward", async () => {
  const before = (await getUiCredential(db))!;
  await setUiPassword(db, "kata sandi panjang 2");
  const after = (await getUiCredential(db))!;
  expect(await db.uiCredential.count()).toBe(1);
  expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
  expect(await verifyPassword("kata sandi panjang 2", after.passwordHash)).toBe(true);
});
