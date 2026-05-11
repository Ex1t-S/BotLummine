ALTER TABLE "CommerceConnection"
ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "workspaceId"
      ORDER BY
        CASE WHEN "status" = 'ACTIVE' THEN 0 ELSE 1 END,
        "updatedAt" DESC,
        "installedAt" DESC
    ) AS rn
  FROM "CommerceConnection"
  WHERE "status" = 'ACTIVE'
)
UPDATE "CommerceConnection" c
SET "isPrimary" = true
FROM ranked r
WHERE c."id" = r."id"
  AND r.rn = 1;

CREATE INDEX "CommerceConnection_workspaceId_isPrimary_status_idx"
ON "CommerceConnection"("workspaceId", "isPrimary", "status");
