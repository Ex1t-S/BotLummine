CREATE TABLE IF NOT EXISTS "AbandonedCartAutomationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "filters" JSONB,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "minCartAgeMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedCartAutomationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AbandonedCartAutomationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "templateName" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AbandonedCartAutomationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCartAutomationSetting_workspaceId_key"
ON "AbandonedCartAutomationSetting"("workspaceId");

CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_checkoutId_key"
ON "AbandonedCartAutomationLog"("workspaceId", "checkoutId");

CREATE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_createdAt_idx"
ON "AbandonedCartAutomationLog"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_campaignId_idx"
ON "AbandonedCartAutomationLog"("workspaceId", "campaignId");

ALTER TABLE "AbandonedCartAutomationSetting"
ADD CONSTRAINT "AbandonedCartAutomationSetting_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AbandonedCartAutomationLog"
ADD CONSTRAINT "AbandonedCartAutomationLog_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
