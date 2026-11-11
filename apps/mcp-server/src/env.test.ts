import { expect, test } from "vitest";
import { readMcpEnv } from "./env.js";

test("exposes only the API key and URL", () => {
  const env = readMcpEnv("HOSTING_OPS_API_KEY=abc\nSECRETS_MASTER_KEY=zzz\nAPI_PORT=3100\n");
  expect(env).toEqual({ apiKey: "abc", apiUrl: "http://127.0.0.1:3100" });
});

test("defaults to port 3000", () => {
  expect(readMcpEnv("HOSTING_OPS_API_KEY=abc\n").apiUrl).toBe("http://127.0.0.1:3000");
});

test("fails when the API key is missing", () => {
  expect(() => readMcpEnv("API_PORT=3000\n")).toThrow("HOSTING_OPS_API_KEY is missing from .env");
});
