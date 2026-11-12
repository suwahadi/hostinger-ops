import { createTestDb } from "@ops/database/test-db";
import { parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import { storeSecret } from "../services/secrets.js";
import { getUiCredential, verifyPassword } from "../services/ui-password.js";
import { loginAddCommand, uiPasswordCommand } from "./commands.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
const tty = { isTTY: true };
afterAll(() => db.$disconnect());

test("login:add refuses a piped stdin even when the token is already stored, and creates nothing", async () => {
  await storeSecret(db, key, { refKey: "HOSTINGER_TOKEN_SUMBER", value: "tok-1" });
  await expect(
    loginAddCommand(db, key, { args: ["sumber"], stdin: { isTTY: false }, readHidden: vi.fn() }),
  ).rejects.toThrow("Run this command in your own terminal");
  expect(await db.hostingerLogin.count()).toBe(0);
});

test("login:add reuses a stored token and says so", async () => {
  const readHidden = vi.fn();
  expect(await loginAddCommand(db, key, { args: ["sumber"], stdin: tty, readHidden })).toBe(
    "Using stored HOSTINGER_TOKEN_SUMBER. Login sumber added. Ask Claude to run verify_login_connection for sumber.",
  );
  expect(readHidden).not.toHaveBeenCalled();
});

test("login:add asks for the token when none is stored", async () => {
  const readHidden = vi.fn(async () => "tok-2");
  await loginAddCommand(db, key, { args: ["tujuan"], stdin: tty, readHidden });
  expect(readHidden).toHaveBeenCalledWith("Hostinger API token for tujuan: ");
  expect(await db.secretVault.count({ where: { refKey: "HOSTINGER_TOKEN_TUJUAN" } })).toBe(1);
  expect(await db.hostingerLogin.count({ where: { alias: "tujuan" } })).toBe(1);
});

test("ui:password refuses a piped stdin", async () => {
  await expect(uiPasswordCommand(db, { args: [], stdin: { isTTY: false }, readHidden: vi.fn() })).rejects.toThrow(
    "Run this command in your own terminal",
  );
});

test("ui:password rejects two different entries", async () => {
  const readHidden = vi.fn().mockResolvedValueOnce("kata sandi panjang A").mockResolvedValueOnce("kata sandi panjang B");
  await expect(uiPasswordCommand(db, { args: [], stdin: tty, readHidden })).rejects.toThrow("Passwords do not match");
});

test("ui:password stores a verifiable hash", async () => {
  const readHidden = vi.fn().mockResolvedValue("kata sandi panjang 3");
  expect(await uiPasswordCommand(db, { args: [], stdin: tty, readHidden })).toBe(
    "Web password set. Open http://127.0.0.1:3000/ and log in.",
  );
  expect(readHidden.mock.calls.map((c) => c[0])).toEqual(["New web password: ", "Repeat the password: "]);
  expect(await verifyPassword("kata sandi panjang 3", (await getUiCredential(db))!.passwordHash)).toBe(true);
});
