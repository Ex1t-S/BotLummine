CREATE TABLE IF NOT EXISTS "AutomationRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "automationRunId" TEXT;
ALTER TABLE "AbandonedCartAutomationLog" ADD COLUMN IF NOT EXISTS "automationRunId" TEXT;
ALTER TABLE "PendingPaymentAutomationLog" ADD COLUMN IF NOT EXISTS "automationRunId" TEXT;
ALTER TABLE "ShipmentNotificationLog" ADD COLUMN IF NOT EXISTS "automationRunId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationRun_workspaceId_type_runKey_key"
ON "AutomationRun"("workspaceId", "type", "runKey");

CREATE INDEX IF NOT EXISTS "AutomationRun_workspaceId_type_createdAt_idx"
ON "AutomationRun"("workspaceId", "type", "createdAt");

CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_automationRunId_idx"
ON "Campaign"("workspaceId", "automationRunId");

CREATE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_campaignId_externalKey_idx"
ON "CampaignRecipient"("workspaceId", "campaignId", "externalKey");

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_campaignId_externalKey_auto_key"
ON "CampaignRecipient"("workspaceId", "campaignId", "externalKey")
WHERE "externalKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_automationRunId_idx"
ON "AbandonedCartAutomationLog"("workspaceId", "automationRunId");

CREATE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_automationRunId_idx"
ON "PendingPaymentAutomationLog"("workspaceId", "automationRunId");

CREATE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_automationRunId_idx"
ON "ShipmentNotificationLog"("workspaceId", "automationRunId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AutomationRun_workspaceId_fkey'
    ) THEN
        ALTER TABLE "AutomationRun"
        ADD CONSTRAINT "AutomationRun_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_automationRunId_fkey'
    ) THEN
        ALTER TABLE "Campaign"
        ADD CONSTRAINT "Campaign_automationRunId_fkey"
        FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'AbandonedCartAutomationLog_automationRunId_fkey'
    ) THEN
        ALTER TABLE "AbandonedCartAutomationLog"
        ADD CONSTRAINT "AbandonedCartAutomationLog_automationRunId_fkey"
        FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PendingPaymentAutomationLog_automationRunId_fkey'
    ) THEN
        ALTER TABLE "PendingPaymentAutomationLog"
        ADD CONSTRAINT "PendingPaymentAutomationLog_automationRunId_fkey"
        FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentNotificationLog_automationRunId_fkey'
    ) THEN
        ALTER TABLE "ShipmentNotificationLog"
        ADD CONSTRAINT "ShipmentNotificationLog_automationRunId_fkey"
        FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
