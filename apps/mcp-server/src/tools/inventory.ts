import { z } from "zod";
import { ApiError, type ApiClient } from "../client.js";

export type ToolResult = { content: { type: "text"; text: string }[]; isError?: true };

export type InventoryTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject<Record<string, z.ZodType<string | undefined>>>;
  handler: (args: Record<string, string | undefined>) => Promise<ToolResult>;
};

async function run(call: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await call(), null, 2) }] };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { isError: true, content: [{ type: "text", text: error.message }] };
  }
}

export function inventoryTools(client: ApiClient): InventoryTool[] {
  return [
    {
      name: "list_logins",
      description: "List Hostinger logins (one per API token) with connection status and last verification time.",
      inputSchema: z.object({}),
      handler: () => run(() => client.get("/v1/logins")),
    },
    {
      name: "list_accounts",
      description: "List hosting plans (orders) with capacity, optionally for one login alias.",
      inputSchema: z.object({ login: z.string().optional().describe("Login alias") }),
      handler: (args) => run(() => client.get("/v1/accounts", { login: args.login })),
    },
    {
      name: "list_websites",
      description: "Search websites by login alias, account code, project code, or part of the domain.",
      inputSchema: z.object({
        login: z.string().optional().describe("Login alias"),
        account: z.string().optional().describe("Hosting account code"),
        project: z.string().optional().describe("Project code"),
        domain: z.string().optional().describe("Part of the domain, case-insensitive"),
      }),
      handler: (args) =>
        run(() =>
          client.get("/v1/websites", { login: args.login, account: args.account, project: args.project, domain: args.domain }),
        ),
    },
    {
      name: "get_login_capabilities",
      description: "Show which Hostinger API features were verified as available for a login.",
      inputSchema: z.object({ login: z.string().describe("Login alias") }),
      handler: (args) => run(() => client.get(`/v1/logins/${encodeURIComponent(args.login ?? "")}/capabilities`)),
    },
    {
      name: "verify_login_connection",
      description:
        "Test a login's Hostinger API token with read-only requests and update its connection status and capabilities in the local database. Nothing is changed at Hostinger.",
      inputSchema: z.object({ login: z.string().describe("Login alias") }),
      handler: (args) =>
        run(() => client.post(`/v1/logins/${encodeURIComponent(args.login ?? "")}/verify`, { timeoutMs: 180_000 })),
    },
  ];
}
