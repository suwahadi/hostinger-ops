import { parseEnv } from "node:util";

export type McpEnv = { apiKey: string; apiUrl: string };

export function readMcpEnv(envFileContent: string): McpEnv {
  const { HOSTING_OPS_API_KEY: apiKey, API_PORT: port = "3000" } = parseEnv(envFileContent);
  if (!apiKey) throw new Error("HOSTING_OPS_API_KEY is missing from .env");
  return { apiKey, apiUrl: `http://127.0.0.1:${port}` };
}
