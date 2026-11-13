-- Rows synced before NODEJS existed were stored as UNKNOWN with Hostinger's own type kept in metadata.
UPDATE "websites" SET "websiteType" = 'NODEJS' WHERE "websiteType" = 'UNKNOWN' AND "metadata"->'provider'->>'websiteType' = 'nodejs';
