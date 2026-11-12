import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@ops/database";
import { encryptSecret } from "@ops/shared";

export function validateRefKey(refKey: string): void {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(refKey)) {
    throw new Error("Secret name must be UPPER_SNAKE_CASE, 3 to 64 characters");
  }
}

export async function hasSecret(db: PrismaClient, refKey: string): Promise<boolean> {
  return (await db.secretVault.count({ where: { refKey } })) > 0;
}

export async function storeSecret(
  db: PrismaClient,
  masterKey: Buffer,
  input: { refKey: string; value: string },
): Promise<"created" | "rotated"> {
  validateRefKey(input.refKey);
  const value = input.value.trim();
  if (!value) throw new Error("Secret value is empty");
  const encrypted = encryptSecret(value, masterKey);
  const result = (await hasSecret(db, input.refKey)) ? "rotated" : "created";
  await db.$transaction([
    db.secretVault.upsert({
      where: { refKey: input.refKey },
      create: { refKey: input.refKey, category: "API_TOKEN", ...encrypted },
      update: { ...encrypted, rotatedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        requestId: randomUUID(),
        actor: "CLI_HUMAN",
        action: "SECRET_SET",
        resource: "secret_vault",
        resourceId: input.refKey,
        result,
      },
    }),
  ]);
  return result;
}
