CREATE TABLE "WorkspaceFeatureFlag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceFeatureFlag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceFeatureFlag_workspaceId_key_key" ON "WorkspaceFeatureFlag"("workspaceId", "key");
CREATE INDEX "WorkspaceFeatureFlag_workspaceId_enabled_idx" ON "WorkspaceFeatureFlag"("workspaceId", "enabled");

ALTER TABLE "WorkspaceFeatureFlag"
ADD CONSTRAINT "WorkspaceFeatureFlag_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceFeatureFlag"
ADD CONSTRAINT "WorkspaceFeatureFlag_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
