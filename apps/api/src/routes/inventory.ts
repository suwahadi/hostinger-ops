import type { PrismaClient } from "@ops/database";
import { AccountSummary, CapabilitySummary, LoginSummary, WebsiteSummary } from "@ops/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { VerifyResult } from "../services/verify-login.js";

const iso = (date: Date | null) => date?.toISOString() ?? null;

const AccountsQuery = z.object({ login: z.string().optional() });
const WebsitesQuery = z.object({
  login: z.string().optional(),
  account: z.string().optional(),
  project: z.string().optional(),
  domain: z.string().optional(),
});

function parseQuery<T>(schema: z.ZodType<T>, query: unknown, reply: FastifyReply): T | undefined {
  const parsed = schema.safeParse(query);
  if (!parsed.success) reply.code(400).send({ error: "invalid_query" });
  return parsed.data;
}

export function inventoryRoutes(
  db: PrismaClient,
  verify: (alias: string, requestId: string) => Promise<VerifyResult | null>,
): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Params: { alias: string } }>("/logins/:alias/verify", async (request, reply) => {
      const result = await verify(request.params.alias, request.id);
      if (!result) return reply.code(404).send({ error: "login_not_found" });
      return result;
    });

    app.get("/logins", async () => {
      const logins = await db.hostingerLogin.findMany({ orderBy: { alias: "asc" } });
      return { logins: logins.map((l) => LoginSummary.parse({ ...l, lastVerifiedAt: iso(l.lastVerifiedAt) })) };
    });

    app.get("/accounts", async (request, reply) => {
      const query = parseQuery(AccountsQuery, request.query, reply);
      if (!query) return reply;
      const accounts = await db.hostingAccount.findMany({
        where: query.login ? { login: { alias: query.login } } : {},
        include: { login: { select: { alias: true } } },
        orderBy: { code: "asc" },
      });
      return {
        accounts: accounts.map((a) =>
          AccountSummary.parse({ ...a, loginAlias: a.login.alias, lastSyncedAt: iso(a.lastSyncedAt) }),
        ),
      };
    });

    app.get("/websites", async (request, reply) => {
      const query = parseQuery(WebsitesQuery, request.query, reply);
      if (!query) return reply;
      const websites = await db.website.findMany({
        where: {
          account: { code: query.account, login: query.login ? { alias: query.login } : undefined },
          project: query.project ? { code: query.project } : undefined,
          domain: query.domain ? { contains: query.domain, mode: "insensitive" } : undefined,
        },
        include: { account: { select: { code: true } }, project: { select: { code: true } } },
        orderBy: { domain: "asc" },
      });
      return {
        websites: websites.map((w) =>
          WebsiteSummary.parse({ ...w, accountCode: w.account.code, projectCode: w.project?.code ?? null }),
        ),
      };
    });

    app.get<{ Params: { alias: string } }>("/logins/:alias/capabilities", async (request, reply) => {
      const login = await db.hostingerLogin.findUnique({
        where: { alias: request.params.alias },
        include: { capabilities: { orderBy: { name: "asc" } } },
      });
      if (!login) return reply.code(404).send({ error: "login_not_found" });
      return {
        capabilities: login.capabilities.map((c) => CapabilitySummary.parse({ ...c, checkedAt: iso(c.checkedAt) })),
      };
    });
  };
}
