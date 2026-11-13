import type { Prisma, PrismaClient } from "@ops/database";
import {
  createHostingerClient,
  createTokenProvider,
  TokenUnavailableError,
  type HostingerClient,
  type RateLimiter,
  type Sleep,
} from "@ops/hostinger-adapter";
import { z } from "zod";
import type { JobRow } from "../queue.js";

export type DetectDeps = {
  db: PrismaClient;
  masterKey: Buffer;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  sleep?: Sleep;
  actor?: "WORKER" | "CLAUDE_MCP";
};

type DetectedType = "LARAVEL" | "WORDPRESS" | "CUSTOM_PHP" | "STATIC" | "UNKNOWN";
type Detection = { type: DetectedType; evidence: string } | { type: "UNKNOWN"; error: string };

const Listing = z.object({ items: z.array(z.object({ name: z.string(), type: z.string() })) });
const Content = z.object({ content: z.string() });

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// Built from the owner's Laravel examples: their document root holds Laravel's public/ contents, so index.php is
// Laravel's own front controller (LARAVEL_START); a whole project dropped into the root shows an artisan file instead.
export function classifyDocumentRoot(rootFiles: string[], indexPhp: string | null | undefined): { type: DetectedType; evidence: string } {
  const files = new Set(rootFiles);
  if (files.has("artisan")) return { type: "LARAVEL", evidence: "file artisan di folder web" };
  if (indexPhp && /LARAVEL_START|Illuminate\\/.test(indexPhp)) return { type: "LARAVEL", evidence: "index.php milik Laravel (LARAVEL_START)" };
  if (indexPhp && indexPhp.includes("wp-blog-header.php")) return { type: "WORDPRESS", evidence: "index.php memanggil wp-blog-header.php" };
  if (files.has("index.php")) {
    return { type: "CUSTOM_PHP", evidence: indexPhp === null ? "index.php (isinya tidak bisa dibaca)" : "index.php tanpa tanda Laravel atau WordPress" };
  }
  if (files.has("index.html") || files.has("index.htm")) return { type: "STATIC", evidence: "hanya index.html, tanpa index.php" };
  return { type: "UNKNOWN", evidence: "tidak ada index.php atau index.html di folder web" };
}

async function readDocumentRoot(client: HostingerClient, username: string, domain: string): Promise<Detection> {
  const base = `/api/hosting/v1/accounts/${encodeURIComponent(username)}/domains/${encodeURIComponent(domain)}/files`;
  const list = await client.get(base, { max_depth: 1, max_items: 500 });
  if (list.status !== 200) return { type: "UNKNOWN", error: `daftar file: ${list.status ?? list.error}` };
  const parsed = Listing.safeParse(list.body);
  if (!parsed.success) return { type: "UNKNOWN", error: "daftar file: respons tidak dikenal" };
  const files = parsed.data.items.filter((item) => item.type === "file").map((item) => item.name);
  let indexPhp: string | null | undefined;
  if (files.includes("index.php") && !files.includes("artisan")) {
    const content = await client.get(`${base}/content`, { path: "index.php", max_lines: 80 });
    indexPhp = content.status === 200 ? (Content.safeParse(content.body).data?.content ?? null) : null;
  }
  return classifyDocumentRoot(files, indexPhp);
}

export async function detectWebsiteTypes(deps: DetectDeps, job: JobRow) {
  const { db } = deps;
  const actor = deps.actor ?? "WORKER";
  const sites = await db.website.findMany({
    where: { websiteType: "UNKNOWN", status: { not: "UNKNOWN" } },
    include: { account: { include: { login: true, access: { include: { login: true } } } } },
    orderBy: { domain: "asc" },
  });
  const clients = new Map<string, HostingerClient | null>();
  const clientFor = async (login: { id: string; alias: string; tokenRef: string }) => {
    if (!clients.has(login.id)) {
      try {
        const token = await createTokenProvider({ db, masterKey: deps.masterKey }).getToken(login.tokenRef);
        clients.set(
          login.id,
          createHostingerClient({
            token,
            limiterKey: login.id,
            limiter: deps.limiter,
            fetch: deps.fetch,
            sleep: deps.sleep,
            onCall: async (call) => {
              await db.auditLog.create({
                data: {
                  requestId: job.id,
                  actor,
                  action: "HOSTINGER_API_CALL",
                  resource: "hostinger_login",
                  resourceId: login.alias,
                  result: String(call.status ?? call.error),
                  detail: { path: call.path, attempt: call.attempt, durationMs: call.durationMs },
                },
              });
            },
          }),
        );
      } catch (error) {
        if (!(error instanceof TokenUnavailableError)) throw error;
        clients.set(login.id, null);
      }
    }
    return clients.get(login.id)!;
  };

  const counts = { checked: 0, laravel: 0, wordpress: 0, php: 0, static: 0, unknown: 0, errors: 0 };
  const tally: Record<DetectedType, keyof typeof counts> = { LARAVEL: "laravel", WORDPRESS: "wordpress", CUSTOM_PHP: "php", STATIC: "static", UNKNOWN: "unknown" };
  for (const site of sites) {
    // Hostinger already names Node.js apps; only its catch-all "other" (or no type at all) is worth a look.
    if (asObject(asObject(site.metadata).provider).websiteType === "nodejs") continue;
    const login = site.account.login ?? site.account.access[0]?.login ?? null;
    const client = login ? await clientFor(login) : null;
    const detection: Detection =
      !site.account.username || !client
        ? { type: "UNKNOWN", error: !site.account.username ? "username paket tidak diketahui" : "token login tidak tersedia" }
        : await readDocumentRoot(client, site.account.username, site.domain);
    await db.website.update({
      where: { id: site.id },
      data: {
        ...(detection.type !== "UNKNOWN" ? { websiteType: detection.type } : {}),
        metadata: { ...asObject(site.metadata), detection: { ...detection, checkedAt: new Date().toISOString() } } as Prisma.InputJsonObject,
      },
    });
    await db.auditLog.create({
      data: {
        requestId: job.id,
        actor,
        action: "WEBSITE_TYPE_DETECTION",
        resource: "website",
        resourceId: site.domain,
        result: "error" in detection ? "error" : detection.type,
        detail: "error" in detection ? { error: detection.error } : { evidence: detection.evidence },
      },
    });
    counts.checked++;
    if ("error" in detection) counts.errors++;
    else counts[tally[detection.type]]++;
  }
  return counts;
}
