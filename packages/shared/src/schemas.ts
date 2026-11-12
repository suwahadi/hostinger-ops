import { z } from "zod";

const isoDate = z.string().nullable();

export const LoginSummary = z.object({
  alias: z.string(),
  status: z.string(),
  lastVerifiedAt: isoDate,
  lastSyncedAt: isoDate,
  sync: z
    .object({ jobId: z.string(), status: z.string(), error: z.string().nullable(), finishedAt: isoDate })
    .nullable(),
});
export type LoginSummary = z.infer<typeof LoginSummary>;

export const AccountSummary = z.object({
  code: z.string(),
  loginAlias: z.string(),
  username: z.string().nullable(),
  planType: z.string().nullable(),
  status: z.string().nullable(),
  datacenter: z.string().nullable(),
  websiteCount: z.number().nullable(),
  websiteLimit: z.number().nullable(),
  expiresAt: isoDate,
  autoRenew: z.boolean().nullable(),
  sharedWith: z.array(z.string()),
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

export const WebsiteDetail = WebsiteSummary.extend({
  loginAlias: z.string(),
  webRoot: z.string().nullable(),
  metadata: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WebsiteDetail = z.infer<typeof WebsiteDetail>;

export const CapabilitySummary = z.object({
  name: z.string(),
  available: z.boolean(),
  httpStatus: z.number().nullable(),
  note: z.string().nullable(),
  checkedAt: isoDate,
});
export type CapabilitySummary = z.infer<typeof CapabilitySummary>;
