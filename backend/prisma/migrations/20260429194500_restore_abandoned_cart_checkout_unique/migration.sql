WITH ranked_carts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "checkoutId"
      ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC NULLS LAST, "id" DESC
    ) AS duplicate_rank
  FROM "AbandonedCart"
  WHERE "checkoutId" IS NOT NULL
)
DELETE FROM "AbandonedCart"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_carts
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCart_checkoutId_key"
ON "AbandonedCart"("checkoutId");
