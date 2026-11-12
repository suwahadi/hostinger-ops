import { parseArgs } from "node:util";
import type { PrismaClient } from "@ops/database";
import { addLogin, assertNewAlias, defaultTokenRef } from "../services/logins.js";
import { hasSecret, storeSecret } from "../services/secrets.js";
import { assertInteractive } from "./prompt.js";

export type CliIo = {
  args: string[];
  stdin: { isTTY?: boolean };
  readHidden: (question: string) => Promise<string>;
};

export async function loginAddCommand(db: PrismaClient, masterKey: Buffer, io: CliIo): Promise<string> {
  // Checked before anything else: the audit row names CLI_HUMAN, which is only true when a person is at the terminal.
  assertInteractive(io.stdin);
  const { values, positionals } = parseArgs({
    args: io.args,
    allowPositionals: true,
    options: { "token-ref": { type: "string" } },
  });
  const alias = positionals[0];
  if (!alias) throw new Error("Usage: pnpm ops:login:add <alias> [--token-ref <SECRET_NAME>]");
  await assertNewAlias(db, alias);
  const tokenRef = values["token-ref"] ?? defaultTokenRef(alias);
  let prefix = "";
  if (await hasSecret(db, tokenRef)) {
    prefix = `Using stored ${tokenRef}. `;
  } else {
    const token = await io.readHidden(`Hostinger API token for ${alias}: `);
    await storeSecret(db, masterKey, { refKey: tokenRef, value: token });
  }
  await addLogin(db, { alias, tokenRef });
  return `${prefix}Login ${alias} added. Ask Claude to run verify_login_connection for ${alias}.`;
}
