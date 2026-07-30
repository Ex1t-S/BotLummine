ALTER TABLE "Campaign" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Campaign_workspaceId_archivedAt_createdAt_idx"
ON "Campaign"("workspaceId", "archivedAt", "createdAt");
