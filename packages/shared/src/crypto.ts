import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = { cipherText: string; iv: string; authTag: string };

const ALGORITHM = "aes-256-gcm";

export function parseMasterKey(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("SECRETS_MASTER_KEY must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const cipherText = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    cipherText: cipherText.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(secret.iv, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(secret.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(secret.cipherText, "base64")), decipher.final()]).toString("utf8");
}
