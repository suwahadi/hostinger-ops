import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createApiClient } from "./client.js";
import { readMcpEnv } from "./env.js";
import { inventoryTools } from "./tools/inventory.js";

// stdout carries the MCP protocol; anything else written there corrupts the stream, so logs go to stderr.
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
let env;
try {
  env = readMcpEnv(readFileSync(envFile, "utf8"));
} catch (error) {
  process.stderr.write(`hostinger-ops MCP: ${error instanceof Error ? error.message : "cannot read .env"}\n`);
  process.exit(1);
}

const tools = inventoryTools(createApiClient(env));

serveStdio(
  () => {
    const server = new McpServer({ name: "hostinger-ops", version: "0.0.0" }, { capabilities: { tools: {} } });
    for (const tool of tools) {
      server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
    }
    return server;
  },
  { onerror: (error) => process.stderr.write(`hostinger-ops MCP: ${error.message}\n`) },
);
