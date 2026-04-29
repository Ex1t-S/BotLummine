ALTER TABLE "AbandonedCart" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "AbandonedCart"
SET "workspaceId" = COALESCE("workspaceId", "storeId", 'default')
WHERE "workspaceId" IS NULL;
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" SET DEFAULT 'default';
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "CustomerProfile"
SET "workspaceId" = COALESCE("workspaceId", "storeId", 'default')
WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" SET DEFAULT 'default';
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "CustomerOrder"
SET "workspaceId" = COALESCE("workspaceId", "storeId", 'default')
WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" SET DEFAULT 'default';
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "CustomerOrderItem"
SET "workspaceId" = COALESCE("workspaceId", "storeId", 'default')
WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" SET DEFAULT 'default';
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "CustomerSyncLog"
SET "workspaceId" = COALESCE("workspaceId", "storeId", 'default')
WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" SET DEFAULT 'default';
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_status_updatedAt_idx"
ON "AbandonedCart"("workspaceId", "status", "updatedAt");

CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_idx"
ON "CustomerProfile"("workspaceId", "storeId");

CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_orderCreatedAt_idx"
ON "CustomerOrder"("workspaceId", "storeId", "orderCreatedAt");

CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_storeId_normalizedName_idx"
ON "CustomerOrderItem"("workspaceId", "storeId", "normalizedName");

CREATE INDEX IF NOT EXISTS "CustomerSyncLog_workspaceId_storeId_status_startedAt_idx"
ON "CustomerSyncLog"("workspaceId", "storeId", "status", "startedAt");
