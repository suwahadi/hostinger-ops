import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

function runHook(message: string): number {
  const file = join(mkdtempSync(join(tmpdir(), "hook-")), "MSG");
  writeFileSync(file, message);
  try {
    execFileSync("sh", [".githooks/commit-msg", file], { stdio: "pipe" });
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

test("accepts a plain message", () => {
  expect(runHook("Add shared crypto module\n")).toBe(0);
});

test.each([
  "Add x\n\nCo-authored-by: Claude <noreply@anthropic.com>\n",
  "Add x\n\nCo-Authored-By: Copilot <x@github.com>\n",
  "Add x\n\nGenerated with [Claude Code](https://claude.com/claude-code)\n",
])("rejects AI attribution: %s", (message) => {
  expect(runHook(message)).not.toBe(0);
});
