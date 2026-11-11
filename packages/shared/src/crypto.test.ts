import { expect, test } from "vitest";
import { decryptSecret, encryptSecret, parseMasterKey } from "./crypto.js";

const key = parseMasterKey("ab".repeat(32));

function flipFirstByte(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  bytes[0]! ^= 1;
  return bytes.toString("base64");
}

test("round-trips a secret", () => {
  expect(decryptSecret(encryptSecret("rahasia-123", key), key)).toBe("rahasia-123");
});

test("uses a fresh 12-byte IV each time", () => {
  const a = encryptSecret("x", key);
  const b = encryptSecret("x", key);
  expect(a.iv).not.toBe(b.iv);
  expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
  expect(Buffer.from(a.authTag, "base64")).toHaveLength(16);
});

test("rejects tampered cipherText and authTag", () => {
  const secret = encryptSecret("rahasia", key);
  expect(() => decryptSecret({ ...secret, cipherText: flipFirstByte(secret.cipherText) }, key)).toThrow();
  expect(() => decryptSecret({ ...secret, authTag: flipFirstByte(secret.authTag) }, key)).toThrow();
});

test("rejects a wrong key", () => {
  expect(() => decryptSecret(encryptSecret("x", key), parseMasterKey("cd".repeat(32)))).toThrow();
});

test.each([undefined, "", "abc", "zz".repeat(32), "ab".repeat(31)])(
  "rejects master key %s without echoing it",
  (bad) => {
    expect(() => parseMasterKey(bad)).toThrow(/^SECRETS_MASTER_KEY must be 64 hex characters$/);
  },
);
