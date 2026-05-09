CREATE TABLE IF NOT EXISTS "ShipmentNotificationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "daysBack" INTEGER NOT NULL DEFAULT 3,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentNotificationSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentNotificationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "shipmentId" TEXT,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentNotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentNotificationSetting_workspaceId_key" ON "ShipmentNotificationSetting"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_notificationKey_key" ON "ShipmentNotificationLog"("workspaceId", "notificationKey");
CREATE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_sentAt_idx" ON "ShipmentNotificationLog"("workspaceId", "sentAt");
CREATE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_campaignId_idx" ON "ShipmentNotificationLog"("workspaceId", "campaignId");

ALTER TABLE "ShipmentNotificationSetting" ADD CONSTRAINT "ShipmentNotificationSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShipmentNotificationLog" ADD CONSTRAINT "ShipmentNotificationLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
