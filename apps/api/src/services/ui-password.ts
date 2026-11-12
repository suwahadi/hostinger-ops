import { randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { PrismaClient } from "@ops/database";

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MIN_LENGTH = 12;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function getUiCredential(db: PrismaClient): Promise<{ passwordHash: string; updatedAt: Date } | null> {
  return db.uiCredential.findUnique({ where: { id: 1 }, select: { passwordHash: true, updatedAt: true } });
}

export async function setUiPassword(db: PrismaClient, password: string): Promise<void> {
  if (password.length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters`);
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.uiCredential.upsert({ where: { id: 1 }, create: { id: 1, passwordHash }, update: { passwordHash } }),
    db.auditLog.create({
      data: {
        requestId: randomUUID(),
        actor: "CLI_HUMAN",
        action: "UI_PASSWORD_SET",
        resource: "ui_credentials",
        result: "set",
      },
    }),
  ]);
}
