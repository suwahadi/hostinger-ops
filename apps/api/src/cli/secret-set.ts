import { storeSecret, validateRefKey } from "../services/secrets.js";
import { assertInteractive, readHidden } from "./prompt.js";
import { runCli } from "./run.js";

await runCli(async (db, masterKey) => {
  const refKey = process.argv[2];
  if (!refKey) throw new Error("Usage: pnpm ops:secret:set <SECRET_NAME>");
  validateRefKey(refKey);
  assertInteractive(process.stdin);
  const value = await readHidden(`Value for ${refKey}: `);
  return `Stored ${refKey} (${await storeSecret(db, masterKey, { refKey, value })})`;
});
