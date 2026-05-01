CREATE TABLE "CampaignSchedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateLocalId" TEXT,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "audienceSource" TEXT NOT NULL DEFAULT 'abandoned_carts',
    "audienceFilters" JSONB,
    "defaultComponents" JSONB,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "timeOfDay" TEXT NOT NULL DEFAULT '22:00',
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunKey" TEXT,
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CampaignSchedule_workspaceId_status_nextRunAt_idx" ON "CampaignSchedule"("workspaceId", "status", "nextRunAt");
CREATE INDEX "CampaignSchedule_workspaceId_createdAt_idx" ON "CampaignSchedule"("workspaceId", "createdAt");

ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
