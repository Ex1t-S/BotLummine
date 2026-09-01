-- Campaign history was previously auto-archived by a read endpoint after ten rows.
-- Restore those records; archive is now an explicit, audited action.
UPDATE "Campaign" SET "archivedAt" = NULL WHERE "archivedAt" IS NOT NULL;
