import { uiPasswordCommand } from "./commands.js";
import { readHidden } from "./prompt.js";
import { runCli } from "./run.js";

await runCli((db) => uiPasswordCommand(db, { args: process.argv.slice(2), stdin: process.stdin, readHidden }));
