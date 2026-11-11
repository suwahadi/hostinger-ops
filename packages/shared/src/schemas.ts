import { z } from "zod";

const isoDate = z.string().nullable();

export const LoginSummary = z.object({
  alias: z.string(),
  status: z.string(),
  lastVerifiedAt: isoDate,
});
export type LoginSummary = z.infer<typeof LoginSummary>;

export const AccountSummary = z.object({
  code: z.string(),
  loginAlias: z.string(),
  planType: z.string().nullable(),
  datacenter: z.string().nullable(),
  websiteCount: z.number().nullable(),
  websiteLimit: z.number().nullable(),
  lastSyncedAt: isoDate,
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const WebsiteSummary = z.object({
  domain: z.string(),
  accountCode: z.string(),
  websiteType: z.string(),
  status: z.string(),
  phpVersion: z.string().nullable(),
  projectCode: z.string().nullable(),
});
export type WebsiteSummary = z.infer<typeof WebsiteSummary>;

export const CapabilitySummary = z.object({
  name: z.string(),
  available: z.boolean(),
  httpStatus: z.number().nullable(),
  note: z.string().nullable(),
  checkedAt: isoDate,
});
export type CapabilitySummary = z.infer<typeof CapabilitySummary>;
