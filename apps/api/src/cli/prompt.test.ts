import { expect, test } from "vitest";
import { assertInteractive } from "./prompt.js";

test.each([[{ isTTY: false }], [{}]])("refuses a non-interactive stdin %o", (stream) => {
  expect(() => assertInteractive(stream)).toThrow("Run this command in your own terminal: the secret must be typed, not piped");
});

test("accepts a TTY", () => {
  expect(() => assertInteractive({ isTTY: true })).not.toThrow();
});
