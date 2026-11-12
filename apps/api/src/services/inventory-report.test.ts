import { createTestDb } from "@ops/database/test-db";
import { afterAll, expect, test } from "vitest";
import { capacityReport, inventoryTotals } from "./inventory-report.js";
import { requestSync } from "./sync-request.js";

const db = await createTestDb();
afterAll(() => db.$disconnect());

const sumber = await db.hostingerLogin.create({ data: { alias: "sumber", tokenRef: "HOSTINGER_TOKEN_SUMBER" } });
const planA = await db.hostingAccount.create({ data: { code: "A", loginId: sumber.id, status: "active", websiteCount: 3 } });
const planC = await db.hostingAccount.create({ data: { code: "C", loginId: sumber.id, status: "UNKNOWN", websiteCount: 1 } });
await db.website.createMany({
  data: [
    { accountId: planA.id, domain: "satu.com", websiteType: "WORDPRESS" },
    { accountId: planA.id, domain: "dua.com", websiteType: "WORDPRESS" },
    { accountId: planA.id, domain: "hilang.com", websiteType: "WORDPRESS", status: "UNKNOWN" },
    { accountId: planC.id, domain: "lama.com" },
  ],
});

test("totals skip UNKNOWN plans and UNKNOWN websites", async () => {
  expect(await inventoryTotals(db)).toEqual({ logins: 1, accounts: 1, websites: 2, wordpress: 2 });
});

test("capacity totals match inventoryTotals", async () => {
  const report = await capacityReport(db);
  expect(report.totals).toEqual({ accounts: 1, websites: 2 });
  expect(report.logins[0]!.totals).toEqual({ accounts: 1, websites: 2, unknownAccounts: 1 });
});

test("requestSync audits each login and reports a repeat as already queued", async () => {
  await requestSync(db, { actor: "WEB_HUMAN", requestId: "r1" });
  await requestSync(db, { login: "sumber", actor: "WEB_HUMAN", requestId: "r2" });
  const rows = await db.auditLog.findMany({
    where: { action: "SYNC_REQUEST" },
    orderBy: [{ createdAt: "asc" }, { requestId: "asc" }],
  });
  expect(rows.map((r) => [r.actor, r.resourceId, r.result])).toEqual([
    ["WEB_HUMAN", "sumber", "queued"],
    ["WEB_HUMAN", "sumber", "already_queued"],
  ]);
  expect(await requestSync(db, { login: "tidak-ada", actor: "WEB_HUMAN", requestId: "r3" })).toBeNull();
});
