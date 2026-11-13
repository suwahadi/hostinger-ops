import { randomUUID } from "node:crypto";
import { createTestDb } from "@ops/database/test-db";
import { encryptSecret, parseMasterKey } from "@ops/shared";
import { afterAll, expect, test, vi } from "vitest";
import { classifyDocumentRoot, detectWebsiteTypes } from "./website-type.js";

const db = await createTestDb();
const key = parseMasterKey("ab".repeat(32));
const token = "tok-rahasia-789";
afterAll(() => db.$disconnect());

const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
await db.secretVault.create({ data: { refKey: "HOSTINGER_TOKEN_SUMBER", ...encryptSecret(token, key) } });
const account = await db.hostingAccount.create({ data: { code: "5001", loginId: sumber.id, username: "u100000001" } });

const LARAVEL_INDEX = "<?php\nuse Illuminate\\Http\\Request;\ndefine('LARAVEL_START', microtime(true));\nrequire $appBootstrapPath;";
type Site = { files: string[]; index?: string; listStatus?: number };

function hostingerFiles(sites: Record<string, Site>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const match = url.pathname.match(/^\/api\/hosting\/v1\/accounts\/([^/]+)\/domains\/([^/]+)\/files(\/content)?$/);
    const site = match && decodeURIComponent(match[1]!) === "u100000001" ? sites[decodeURIComponent(match[2]!)] : undefined;
    if (!site || new Headers(init?.headers).get("authorization") !== `Bearer ${token}`) return new Response("{}", { status: 404 });
    if (match![3]) {
      return url.searchParams.get("path") === "index.php" && site.index !== undefined
        ? Response.json({ path: "index.php", content: site.index, from_line: 0, total_lines: 4, size_bytes: 100 })
        : new Response("{}", { status: 422 });
    }
    if (site.listStatus) return new Response("{}", { status: site.listStatus });
    const items = site.files.map((name) => ({ name, path: name, type: name.endsWith("/") ? "directory" : "file", size_bytes: 1 }));
    return Response.json({ path: "", items: items.map((i) => ({ ...i, name: i.name.replace(/\/$/, "") })), total_items: items.length });
  });
}

const deps = (fetch: typeof globalThis.fetch) => ({ db, masterKey: key, limiter: { acquire: async () => {} }, sleep: async () => {}, fetch });
const job = () => ({ id: randomUUID(), kind: "detect-website-types", attempts: 1, payload: {} });

test("classification follows the owner's Laravel examples, then WordPress, plain PHP and static", () => {
  expect(classifyDocumentRoot(["index.php", ".htaccess"], LARAVEL_INDEX).type).toBe("LARAVEL");
  expect(classifyDocumentRoot(["artisan", "composer.json"], undefined).type).toBe("LARAVEL");
  expect(classifyDocumentRoot(["index.php"], "<?php\nrequire __DIR__ . '/wp-blog-header.php';").type).toBe("WORDPRESS");
  expect(classifyDocumentRoot(["index.php"], "<?php echo 'halo';").type).toBe("CUSTOM_PHP");
  expect(classifyDocumentRoot(["index.php"], null).type).toBe("CUSTOM_PHP");
  expect(classifyDocumentRoot(["index.html", "style.css"], undefined).type).toBe("STATIC");
  expect(classifyDocumentRoot([".htaccess"], undefined).type).toBe("UNKNOWN");
});

test("the job reads each unrecognised website's document root and stores the type with its evidence", async () => {
  await db.website.createMany({
    data: [
      { accountId: account.id, domain: "laravel-contoh.com", metadata: { provider: { websiteType: "other", vhostType: "main" } } },
      { accountId: account.id, domain: "php-contoh.com", metadata: { provider: { websiteType: "other" } } },
      { accountId: account.id, domain: "statis-contoh.com", metadata: { provider: { websiteType: "other" } } },
      { accountId: account.id, domain: "gagal-contoh.com", metadata: { provider: { websiteType: "other" } } },
      { accountId: account.id, domain: "wp-contoh.com", websiteType: "WORDPRESS", metadata: { provider: { websiteType: "wordpress" } } },
      { accountId: account.id, domain: "node-contoh.com", websiteType: "NODEJS", metadata: { provider: { websiteType: "nodejs" } } },
      { accountId: account.id, domain: "hilang-contoh.com", status: "UNKNOWN" },
    ],
  });
  const fetch = hostingerFiles({
    "laravel-contoh.com": { files: [".htaccess", "index.php", "aplikasi/", "build/"], index: LARAVEL_INDEX },
    "php-contoh.com": { files: ["index.php", "config.php"], index: "<?php include 'config.php';" },
    "statis-contoh.com": { files: ["index.html", "css/"] },
    "gagal-contoh.com": { files: [], listStatus: 403 },
  });
  const result = await detectWebsiteTypes(deps(fetch), job());
  expect(result).toEqual({ checked: 4, laravel: 1, wordpress: 0, php: 1, static: 1, unknown: 0, errors: 1 });

  const site = await db.website.findFirstOrThrow({ where: { domain: "laravel-contoh.com" } });
  expect(site.websiteType).toBe("LARAVEL");
  expect(site.metadata).toMatchObject({ provider: { websiteType: "other", vhostType: "main" }, detection: { type: "LARAVEL" } });
  expect((site.metadata as { detection: { evidence: string } }).detection.evidence).toContain("LARAVEL_START");
  expect((await db.website.findFirstOrThrow({ where: { domain: "php-contoh.com" } })).websiteType).toBe("CUSTOM_PHP");
  expect((await db.website.findFirstOrThrow({ where: { domain: "statis-contoh.com" } })).websiteType).toBe("STATIC");
  const failed = await db.website.findFirstOrThrow({ where: { domain: "gagal-contoh.com" } });
  expect(failed.websiteType).toBe("UNKNOWN");
  expect(failed.metadata).toMatchObject({ detection: { type: "UNKNOWN", error: "daftar file: 403" } });

  const visited = fetch.mock.calls.map(([url]) => new URL(String(url)).pathname);
  expect(visited.some((p) => p.includes("wp-contoh.com") || p.includes("node-contoh.com") || p.includes("hilang-contoh.com"))).toBe(false);
  expect(visited.filter((p) => p.endsWith("/content"))).toHaveLength(2);
  expect(await db.auditLog.count({ where: { action: "WEBSITE_TYPE_DETECTION", actor: "WORKER" } })).toBe(4);
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(token);
});
