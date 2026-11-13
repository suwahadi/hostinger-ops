import type { PrismaClient } from "@ops/database";
import {
  createHostingerClient,
  createTokenProvider,
  defaultSleep,
  TokenUnavailableError,
  type RateLimiter,
  type Sleep,
} from "@ops/hostinger-adapter";
import { isPlainHostname } from "@ops/shared";
import { z } from "zod";
import type { JobRow } from "../queue.js";
import type { Rdap } from "../rdap.js";

export type ExpiryDeps = {
  db: PrismaClient;
  masterKey: Buffer;
  limiter: RateLimiter;
  fetch?: typeof fetch;
  sleep?: Sleep;
  rdap: Pick<Rdap, "lookup">;
  requestId: string;
  actor: "WEB_HUMAN" | "WORKER" | "CLAUDE_MCP";
};

export type ExpiryCheck =
  | { outcome: "found"; domain: string; expiresAt: Date; source: "HOSTINGER" | "RDAP" }
  | { outcome: "temporary" }
  | { outcome: "invalid" }
  | { outcome: "not_found" }
  | { outcome: "error"; reason: string };

const TEMPORARY_SUFFIXES = ["hostingersite.com"];
// Zones PANDI sells names under; they are never a registered domain on their own, so RDAP is not asked about them.
const ID_SECOND_LEVEL = new Set(["co.id", "ac.id", "or.id", "go.id", "web.id", "my.id", "sch.id", "biz.id", "mil.id", "net.id", "ponpes.id", "desa.id"]);
// Registries publish no RDAP rate limits; one domain per second keeps a bulk run well clear of any sensible one.
const BULK_PAUSE_MS = 1_000;

const Renewal = z.object({ status: z.string().nullish(), expires_at: z.string().nullish() });

export const isTemporaryHostname = (domain: string) => TEMPORARY_SUFFIXES.some((suffix) => domain.toLowerCase().endsWith(`.${suffix}`));

export function registrableCandidates(domain: string): string[] {
  const labels = domain.toLowerCase().split(".");
  const names: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) {
    const name = labels.slice(i).join(".");
    if (ID_SECOND_LEVEL.has(name)) break;
    names.push(name);
  }
  return names;
}

const validDate = (value: string | null | undefined) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);

export async function checkDomainExpiry(deps: ExpiryDeps, domain: string): Promise<ExpiryCheck> {
  const { db } = deps;
  const name = domain.trim().toLowerCase();
  const audit = (action: string, result: string, detail?: object) =>
    db.auditLog.create({ data: { requestId: deps.requestId, actor: deps.actor, action, resource: "domain", resourceId: name, result, detail } });
  const finish = async (check: ExpiryCheck) => {
    const detail = check.outcome === "found" ? { domain: check.domain, source: check.source } : check.outcome === "error" ? { reason: check.reason } : undefined;
    await audit("DOMAIN_EXPIRY_CHECK", check.outcome, detail);
    return check;
  };
  const save = (registered: string, expiresAt: Date, source: "HOSTINGER" | "RDAP", status?: string | null) => {
    const data = { expiresAt, expirySource: source, expiryCheckedAt: new Date(), ...(status ? { status } : {}) };
    return db.domain.upsert({ where: { name: registered }, create: { name: registered, ...data }, update: data });
  };

  if (!isPlainHostname(name)) return finish({ outcome: "invalid" });
  if (isTemporaryHostname(name)) return finish({ outcome: "temporary" });
  const candidates = registrableCandidates(name);

  const owned = (await db.domain.findMany({ where: { name: { in: candidates }, loginId: { not: null } }, include: { login: true } })).sort(
    (a, b) => b.name.length - a.name.length,
  )[0];
  if (owned?.login) {
    const found = await hostingerExpiry(deps, owned.login, owned.name);
    if (found) {
      await save(owned.name, found.expiresAt, "HOSTINGER", found.status);
      return finish({ outcome: "found", domain: owned.name, expiresAt: found.expiresAt, source: "HOSTINGER" });
    }
  }

  // Longest name first: a subdomain is simply not found at the registry, and its registered parent is asked next.
  for (const candidate of candidates) {
    const answer = await deps.rdap.lookup(candidate);
    const { kind, ...detail } = answer;
    await audit("RDAP_LOOKUP", kind, { name: candidate, ...detail });
    if (answer.kind === "found" && answer.expiresAt) {
      await save(candidate, answer.expiresAt, "RDAP");
      return finish({ outcome: "found", domain: candidate, expiresAt: answer.expiresAt, source: "RDAP" });
    }
    if (answer.kind === "error") return finish({ outcome: "error", reason: `${answer.server ?? "RDAP"}: ${answer.reason}` });
    if (answer.kind !== "not_found") break;
  }
  return finish({ outcome: "not_found" });
}

async function hostingerExpiry(
  deps: ExpiryDeps,
  login: { id: string; alias: string; tokenRef: string },
  name: string,
): Promise<{ expiresAt: Date; status: string | null } | null> {
  let token: string;
  try {
    token = await createTokenProvider({ db: deps.db, masterKey: deps.masterKey }).getToken(login.tokenRef);
  } catch (error) {
    if (error instanceof TokenUnavailableError) return null;
    throw error;
  }
  const client = createHostingerClient({
    token,
    limiterKey: login.id,
    limiter: deps.limiter,
    fetch: deps.fetch,
    sleep: deps.sleep,
    onCall: async (call) => {
      await deps.db.auditLog.create({
        data: {
          requestId: deps.requestId,
          actor: deps.actor,
          action: "HOSTINGER_API_CALL",
          resource: "hostinger_login",
          resourceId: login.alias,
          result: String(call.status ?? call.error),
          detail: { path: call.path, attempt: call.attempt, durationMs: call.durationMs },
        },
      });
    },
  });
  const result = await client.get(`/api/domains/v1/portfolio/${encodeURIComponent(name)}/renewal`);
  if (result.status !== 200) return null;
  const parsed = Renewal.safeParse(result.body);
  const expiresAt = parsed.success ? validDate(parsed.data.expires_at) : null;
  return expiresAt ? { expiresAt, status: parsed.data?.status ?? null } : null;
}

export async function domainsWithoutExpiry(db: PrismaClient): Promise<string[]> {
  const [websites, dated] = await Promise.all([
    db.website.findMany({ where: { status: { not: "UNKNOWN" } }, select: { domain: true } }),
    db.domain.findMany({ where: { expiresAt: { not: null } }, select: { name: true } }),
  ]);
  const known = new Set(dated.map((d) => d.name));
  return [...new Set(websites.map((w) => w.domain.toLowerCase()))]
    .filter((d) => isPlainHostname(d) && !isTemporaryHostname(d) && !registrableCandidates(d).some((c) => known.has(c)))
    .sort();
}

export async function checkDomainExpiries(deps: Omit<ExpiryDeps, "requestId" | "actor">, job: JobRow) {
  const sleep = deps.sleep ?? defaultSleep;
  const pending = await domainsWithoutExpiry(deps.db);
  const found = new Set<string>();
  const counts = { pending: pending.length, checked: 0, found: 0, notFound: 0, errors: 0 };
  for (const domain of pending) {
    if (registrableCandidates(domain).some((c) => found.has(c))) continue;
    if (counts.checked > 0) await sleep(BULK_PAUSE_MS);
    const check = await checkDomainExpiry({ ...deps, requestId: job.id, actor: "WORKER" }, domain);
    counts.checked++;
    if (check.outcome === "found") {
      counts.found++;
      found.add(check.domain);
    } else if (check.outcome === "error") counts.errors++;
    else counts.notFound++;
  }
  return counts;
}
