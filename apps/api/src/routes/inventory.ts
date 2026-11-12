import type { PrismaClient } from "@ops/database";
import { CapabilitySummary, WebsiteDetail, WebsiteSummary } from "@ops/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { iso, loginSummaries, toAccountSummary } from "../services/summaries.js";
import type { VerifyResult } from "../services/verify-login.js";

const EXPIRING_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

const LoginQuery = z.object({ login: z.string().optional() });
const WebsitesQuery = z.object({
  login: z.string().optional(),
  account: z.string().optional(),
  project: z.string().optional(),
  domain: z.string().optional(),
});

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown, reply: FastifyReply): T | undefined {
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

    app.get("/logins", async () => ({ logins: await loginSummaries(db) }));

    app.get("/accounts", async (request, reply) => {
      const query = parseQuery(LoginQuery, request.query, reply);
      if (!query) return reply;
      const accounts = await db.hostingAccount.findMany({
        where: query.login ? { login: { alias: query.login } } : {},
        include: { login: { select: { alias: true } } },
        orderBy: { code: "asc" },
      });
      return { accounts: accounts.map(toAccountSummary) };
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

    app.get<{ Params: { domain: string } }>("/websites/:domain", async (request, reply) => {
      const websites = await db.website.findMany({
        where: { domain: { equals: request.params.domain, mode: "insensitive" } },
        include: {
          account: { select: { code: true, login: { select: { alias: true } } } },
          project: { select: { code: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      if (websites.length === 0) return reply.code(404).send({ error: "website_not_found" });
      return {
        websites: websites.map((w) =>
          WebsiteDetail.parse({
            ...w,
            accountCode: w.account.code,
            loginAlias: w.account.login.alias,
            projectCode: w.project?.code ?? null,
            createdAt: w.createdAt.toISOString(),
            updatedAt: w.updatedAt.toISOString(),
          }),
        ),
      };
    });

    app.get("/capacity", async (request, reply) => {
      const query = parseQuery(LoginQuery, request.query, reply);
      if (!query) return reply;
      const logins = await db.hostingerLogin.findMany({
        where: query.login ? { alias: query.login } : {},
        include: { accounts: { include: { login: { select: { alias: true } } } } },
        orderBy: { alias: "asc" },
      });
      const fewestWebsitesFirst = (a: { websiteCount: number | null }, b: { websiteCount: number | null }) =>
        (a.websiteCount ?? Infinity) - (b.websiteCount ?? Infinity);
      const deadline = Date.now() + EXPIRING_WITHIN_MS;
      // UNKNOWN plans no longer appear at Hostinger; their old counts would double-count moved websites.
      const isKnown = (a: { status: string | null }) => a.status !== "UNKNOWN";
      const accounts = logins.flatMap((l) => l.accounts).filter(isKnown);
      return {
        logins: logins.map((login) => {
          const known = login.accounts.filter(isKnown);
          return {
            alias: login.alias,
            totals: {
              accounts: known.length,
              websites: known.reduce((sum, a) => sum + (a.websiteCount ?? 0), 0),
              unknownAccounts: login.accounts.length - known.length,
            },
            accounts: known.sort(fewestWebsitesFirst).map(toAccountSummary),
          };
        }),
        // Already-expired plans are included: they are the most urgent ones.
        expiringSoon: accounts
          .filter((a) => a.expiresAt && a.expiresAt.getTime() <= deadline)
          .sort((a, b) => a.expiresAt!.getTime() - b.expiresAt!.getTime())
          .map(toAccountSummary),
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
