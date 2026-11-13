import type { PrismaClient } from "@ops/database";

// Exact match on the stored (lowercase) domain: an insensitive match is ILIKE in Postgres, where "%" would hit every row.
export async function setWebsiteExcluded(
  db: PrismaClient,
  input: { domain: string; excluded: boolean; actor: "WEB_HUMAN" | "CLAUDE_MCP"; requestId: string },
): Promise<number> {
  const domain = input.domain.trim().toLowerCase();
  if (!domain) return 0;
  const { count } = await db.website.updateMany({ where: { domain }, data: { excludedAt: input.excluded ? new Date() : null } });
  if (count > 0) {
    await db.auditLog.create({
      data: {
        requestId: input.requestId,
        actor: input.actor,
        action: input.excluded ? "WEBSITE_EXCLUDED" : "WEBSITE_INCLUDED",
        resource: "website",
        resourceId: domain,
        result: String(count),
      },
    });
  }
  return count;
}
