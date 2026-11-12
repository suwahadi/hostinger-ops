import { loginAddCommand } from "./commands.js";
import { readHidden } from "./prompt.js";
import { runCli } from "./run.js";

await runCli((db, masterKey) =>
  loginAddCommand(db, masterKey, { args: process.argv.slice(2), stdin: process.stdin, readHidden }),
);
