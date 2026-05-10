CREATE TABLE IF NOT EXISTS "PendingPaymentAutomationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "filters" JSONB,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "minOrderAgeMinutes" INTEGER NOT NULL DEFAULT 120,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingPaymentAutomationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PendingPaymentAutomationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "templateName" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingPaymentAutomationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PendingPaymentAutomationSetting_workspaceId_key"
ON "PendingPaymentAutomationSetting"("workspaceId");

CREATE UNIQUE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_orderKey_key"
ON "PendingPaymentAutomationLog"("workspaceId", "orderKey");

CREATE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_createdAt_idx"
ON "PendingPaymentAutomationLog"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_campaignId_idx"
ON "PendingPaymentAutomationLog"("workspaceId", "campaignId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PendingPaymentAutomationSetting_workspaceId_fkey'
    ) THEN
        ALTER TABLE "PendingPaymentAutomationSetting"
        ADD CONSTRAINT "PendingPaymentAutomationSetting_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PendingPaymentAutomationLog_workspaceId_fkey'
    ) THEN
        ALTER TABLE "PendingPaymentAutomationLog"
        ADD CONSTRAINT "PendingPaymentAutomationLog_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
