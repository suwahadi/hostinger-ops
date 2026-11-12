import { parseArgs } from "node:util";
import { addLogin, assertNewAlias, defaultTokenRef } from "../services/logins.js";
import { hasSecret, storeSecret } from "../services/secrets.js";
import { assertInteractive, readHidden } from "./prompt.js";
import { runCli } from "./run.js";

await runCli(async (db, masterKey) => {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { "token-ref": { type: "string" } } });
  const alias = positionals[0];
  if (!alias) throw new Error("Usage: pnpm ops:login:add <alias> [--token-ref <SECRET_NAME>]");
  await assertNewAlias(db, alias);
  const tokenRef = values["token-ref"] ?? defaultTokenRef(alias);
  if (!(await hasSecret(db, tokenRef))) {
    assertInteractive(process.stdin);
    const token = await readHidden(`Hostinger API token for ${alias}: `);
    await storeSecret(db, masterKey, { refKey: tokenRef, value: token });
  }
  await addLogin(db, { alias, tokenRef });
  return `Login ${alias} added. Ask Claude to run verify_login_connection for ${alias}.`;
});
