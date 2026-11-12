import type { PrismaClient } from "@ops/database";
import { decryptSecret } from "@ops/shared";

export class TokenUnavailableError extends Error {
  readonly reason: "missing" | "unreadable";

  constructor(reason: "missing" | "unreadable", message: string) {
    super(message);
    this.name = "TokenUnavailableError";
    this.reason = reason;
  }
}

export type TokenProvider = { getToken(tokenRef: string): Promise<string> };

export function createTokenProvider(opts: { db: PrismaClient; masterKey: Buffer; env?: NodeJS.ProcessEnv }): TokenProvider {
  const env = opts.env ?? process.env;
  return {
    async getToken(tokenRef) {
      const secret = await opts.db.secretVault.findUnique({ where: { refKey: tokenRef } });
      if (secret) {
        let token: string;
        try {
          token = decryptSecret(secret, opts.masterKey);
        } catch {
          throw new TokenUnavailableError(
            "unreadable",
            `Secret ${tokenRef} cannot be decrypted with the current SECRETS_MASTER_KEY`,
          );
        }
        await opts.db.secretVault.update({ where: { id: secret.id }, data: { lastUsedAt: new Date() } });
        return token;
      }
      const fromEnv = env.NODE_ENV === "development" ? env[tokenRef] : undefined;
      if (fromEnv) return fromEnv;
      throw new TokenUnavailableError("missing", `No secret stored for ${tokenRef}`);
    },
  };
}
