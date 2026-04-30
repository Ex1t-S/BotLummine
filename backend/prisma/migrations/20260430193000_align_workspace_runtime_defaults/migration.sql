DO $$
BEGIN
  CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "CommerceProvider" AS ENUM ('TIENDANUBE', 'SHOPIFY', 'WOOCOMMERCE', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace"("slug");

INSERT INTO "Workspace" ("id", "name", "slug", "status")
VALUES ('workspace_lummine', 'Lummine', 'lummine', 'ACTIVE')
ON CONFLICT ("id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "slug" = EXCLUDED."slug",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;

ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AbandonedCart" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

ALTER TABLE "AbandonedCart" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
ALTER TABLE "CustomerSyncLog" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';

UPDATE "Contact" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "Conversation" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "Message" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "AbandonedCart" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "CustomerProfile" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "CustomerOrder" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "CustomerOrderItem" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "CustomerSyncLog" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "Campaign" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';
UPDATE "CampaignRecipient" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL OR "workspaceId" <> 'workspace_lummine';

ALTER TABLE "Contact" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "Conversation" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "Message" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "Campaign" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';
ALTER TABLE "CampaignRecipient" ALTER COLUMN "workspaceId" SET DEFAULT 'workspace_lummine';

ALTER TABLE "Contact" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Conversation" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Message" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "CampaignRecipient" ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX IF EXISTS "Contact_waId_key";
DROP INDEX IF EXISTS "Conversation_contactId_key";
DROP INDEX IF EXISTS "Message_metaMessageId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_workspaceId_waId_key" ON "Contact"("workspaceId", "waId");
CREATE INDEX IF NOT EXISTS "Contact_workspaceId_updatedAt_idx" ON "Contact"("workspaceId", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_workspaceId_contactId_key" ON "Conversation"("workspaceId", "contactId");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_unreadCount_lastMessageAt_idx" ON "Conversation"("workspaceId", "unreadCount", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_archivedAt_lastMessageAt_idx" ON "Conversation"("workspaceId", "archivedAt", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_queue_aiEnabled_lastMessageAt_idx" ON "Conversation"("workspaceId", "queue", "aiEnabled", "lastMessageAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Message_workspaceId_metaMessageId_key" ON "Message"("workspaceId", "metaMessageId");
CREATE INDEX IF NOT EXISTS "Message_workspaceId_conversationId_createdAt_idx" ON "Message"("workspaceId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_workspaceId_createdAt_idx" ON "Message"("workspaceId", "createdAt");

CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_status_createdAt_idx" ON "Campaign"("workspaceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_campaignId_status_idx" ON "CampaignRecipient"("workspaceId", "campaignId", "status");

DO $$
BEGIN
  ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "AbandonedCart" ADD CONSTRAINT "AbandonedCart_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerOrderItem" ADD CONSTRAINT "CustomerOrderItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CustomerSyncLog" ADD CONSTRAINT "CustomerSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
