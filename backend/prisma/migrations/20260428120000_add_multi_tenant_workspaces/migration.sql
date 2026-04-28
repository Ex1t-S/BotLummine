-- CreateEnum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';

DO $$ BEGIN
    CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "CommerceProvider" AS ENUM ('TIENDANUBE', 'SHOPIFY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR', 'PENDING');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LogisticsProvider" AS ENUM ('ENBOX');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
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

CREATE TABLE IF NOT EXISTS "WorkspaceBranding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "rawProviderBranding" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceBranding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceBranding_workspaceId_key" ON "WorkspaceBranding"("workspaceId");

CREATE TABLE IF NOT EXISTS "WorkspaceAiConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "agentName" TEXT NOT NULL DEFAULT 'Sofi',
    "tone" TEXT NOT NULL DEFAULT 'humana, directa y comercial',
    "systemPrompt" TEXT,
    "businessContext" TEXT,
    "paymentConfig" JSONB,
    "policyConfig" JSONB,
    "catalogConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceAiConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceAiConfig_workspaceId_key" ON "WorkspaceAiConfig"("workspaceId");

CREATE TABLE IF NOT EXISTS "CommerceConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "CommerceProvider" NOT NULL,
    "externalStoreId" TEXT NOT NULL,
    "shopDomain" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scope" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "storeName" TEXT,
    "storeUrl" TEXT,
    "rawPayload" JSONB,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommerceConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommerceConnection_workspaceId_provider_key" ON "CommerceConnection"("workspaceId", "provider");
CREATE UNIQUE INDEX IF NOT EXISTS "CommerceConnection_provider_externalStoreId_key" ON "CommerceConnection"("provider", "externalStoreId");
CREATE INDEX IF NOT EXISTS "CommerceConnection_workspaceId_status_idx" ON "CommerceConnection"("workspaceId", "status");

CREATE TABLE IF NOT EXISTS "LogisticsConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "LogisticsProvider" NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogisticsConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LogisticsConnection_workspaceId_provider_key" ON "LogisticsConnection"("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "LogisticsConnection_workspaceId_status_idx" ON "LogisticsConnection"("workspaceId", "status");

CREATE TABLE IF NOT EXISTS "WhatsAppChannel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Canal principal',
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT,
    "accessToken" TEXT NOT NULL,
    "verifyToken" TEXT,
    "graphVersion" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppChannel_phoneNumberId_key" ON "WhatsAppChannel"("phoneNumberId");
CREATE INDEX IF NOT EXISTS "WhatsAppChannel_workspaceId_status_idx" ON "WhatsAppChannel"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "WhatsAppChannel_wabaId_idx" ON "WhatsAppChannel"("wabaId");

-- Seed existing production brand as first workspace.
INSERT INTO "Workspace" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('workspace_lummine', 'Lummine', 'lummine', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "WorkspaceAiConfig" ("id", "workspaceId", "businessName", "agentName", "tone", "systemPrompt", "businessContext", "createdAt", "updatedAt")
VALUES (
    'workspace_ai_lummine',
    'workspace_lummine',
    'Lummine',
    'Sofi',
    'humana, directa y comercial',
    'Responde como asesora humana de ventas por WhatsApp. Sona natural, directa y comercial.',
    '',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("workspaceId") DO NOTHING;

INSERT INTO "WorkspaceBranding" ("id", "workspaceId", "createdAt", "updatedAt")
VALUES ('workspace_branding_lummine', 'workspace_lummine', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("workspaceId") DO NOTHING;

-- Add tenant columns.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "User" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL AND "role"::text <> 'PLATFORM_ADMIN';

ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "Contact" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "Contact" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "Conversation" c SET "workspaceId" = COALESCE(ct."workspaceId", 'workspace_lummine') FROM "Contact" ct WHERE c."contactId" = ct."id";
UPDATE "Conversation" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "Conversation" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "AiLabRun" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "AiLabRun" r SET "workspaceId" = COALESCE(c."workspaceId", 'workspace_lummine') FROM "Conversation" c WHERE r."conversationId" = c."id";
UPDATE "AiLabRun" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "AiLabRun" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "WhatsAppMenuSetting" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "WhatsAppMenuSetting" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "WhatsAppMenuSetting" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "Message" m SET "workspaceId" = COALESCE(c."workspaceId", 'workspace_lummine') FROM "Conversation" c WHERE m."conversationId" = c."id";
UPDATE "Message" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "Message" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "StoreInstallation" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "StoreInstallation" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "StoreInstallation" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "StoreInstallation" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CatalogProduct" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CatalogProduct" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CatalogProduct" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CatalogProduct" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CatalogSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CatalogSyncLog" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CatalogSyncLog" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CatalogSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "AbandonedCart" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "AbandonedCart" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "AbandonedCart" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerProfile" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CustomerProfile" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CustomerOrder" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerOrderItem" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CustomerOrderItem" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CustomerSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "CustomerSyncLog" ADD COLUMN IF NOT EXISTS "provider" "CommerceProvider" NOT NULL DEFAULT 'TIENDANUBE';
UPDATE "CustomerSyncLog" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "EnboxShipment" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "EnboxShipment" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "EnboxShipment" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "EnboxSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "EnboxSyncLog" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "EnboxSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "WhatsAppTemplate" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "WhatsAppTemplate" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "WhatsAppTemplate" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "TemplateSyncLog" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "TemplateSyncLog" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "TemplateSyncLog" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "Campaign" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "Campaign" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "CampaignRecipient" r SET "workspaceId" = COALESCE(c."workspaceId", 'workspace_lummine') FROM "Campaign" c WHERE r."campaignId" = c."id";
UPDATE "CampaignRecipient" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "CampaignRecipient" ALTER COLUMN "workspaceId" SET NOT NULL;

-- Replace global unique indexes with tenant-aware indexes.
ALTER TABLE "Contact" DROP CONSTRAINT IF EXISTS "Contact_waId_key";
DROP INDEX IF EXISTS "Contact_waId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_workspaceId_waId_key" ON "Contact"("workspaceId", "waId");
CREATE INDEX IF NOT EXISTS "Contact_workspaceId_updatedAt_idx" ON "Contact"("workspaceId", "updatedAt");

ALTER TABLE "Conversation" DROP CONSTRAINT IF EXISTS "Conversation_contactId_key";
DROP INDEX IF EXISTS "Conversation_contactId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_workspaceId_contactId_key" ON "Conversation"("workspaceId", "contactId");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_lastMessageAt_idx" ON "Conversation"("workspaceId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_unreadCount_lastMessageAt_idx" ON "Conversation"("workspaceId", "unreadCount", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_archivedAt_lastMessageAt_idx" ON "Conversation"("workspaceId", "archivedAt", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Conversation_workspaceId_queue_aiEnabled_lastMessageAt_idx" ON "Conversation"("workspaceId", "queue", "aiEnabled", "lastMessageAt");

ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS "Message_metaMessageId_key";
DROP INDEX IF EXISTS "Message_metaMessageId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Message_workspaceId_metaMessageId_key" ON "Message"("workspaceId", "metaMessageId");
CREATE INDEX IF NOT EXISTS "Message_workspaceId_conversationId_createdAt_idx" ON "Message"("workspaceId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_workspaceId_createdAt_idx" ON "Message"("workspaceId", "createdAt");

ALTER TABLE "WhatsAppMenuSetting" DROP CONSTRAINT IF EXISTS "WhatsAppMenuSetting_key_key";
DROP INDEX IF EXISTS "WhatsAppMenuSetting_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMenuSetting_workspaceId_key_key" ON "WhatsAppMenuSetting"("workspaceId", "key");
CREATE INDEX IF NOT EXISTS "WhatsAppMenuSetting_workspaceId_isActive_idx" ON "WhatsAppMenuSetting"("workspaceId", "isActive");

ALTER TABLE "CatalogProduct" DROP CONSTRAINT IF EXISTS "CatalogProduct_storeId_productId_key";
DROP INDEX IF EXISTS "CatalogProduct_storeId_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_provider_productId_key" ON "CatalogProduct"("workspaceId", "provider", "productId");
CREATE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_storeId_published_idx" ON "CatalogProduct"("workspaceId", "storeId", "published");
CREATE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_name_idx" ON "CatalogProduct"("workspaceId", "name");

CREATE INDEX IF NOT EXISTS "CatalogSyncLog_workspaceId_provider_startedAt_idx" ON "CatalogSyncLog"("workspaceId", "provider", "startedAt");

ALTER TABLE "AbandonedCart" DROP CONSTRAINT IF EXISTS "AbandonedCart_checkoutId_key";
DROP INDEX IF EXISTS "AbandonedCart_checkoutId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_provider_checkoutId_key" ON "AbandonedCart"("workspaceId", "provider", "checkoutId");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_status_updatedAt_idx" ON "AbandonedCart"("workspaceId", "status", "updatedAt");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_contactPhone_idx" ON "AbandonedCart"("workspaceId", "contactPhone");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_storeId_checkoutCreatedAt_idx" ON "AbandonedCart"("workspaceId", "storeId", "checkoutCreatedAt");

ALTER TABLE "CustomerProfile" DROP CONSTRAINT IF EXISTS "CustomerProfile_storeId_externalCustomerId_key";
ALTER TABLE "CustomerProfile" DROP CONSTRAINT IF EXISTS "CustomerProfile_storeId_normalizedEmail_key";
ALTER TABLE "CustomerProfile" DROP CONSTRAINT IF EXISTS "CustomerProfile_storeId_normalizedPhone_key";
DROP INDEX IF EXISTS "CustomerProfile_storeId_externalCustomerId_key";
DROP INDEX IF EXISTS "CustomerProfile_storeId_normalizedEmail_key";
DROP INDEX IF EXISTS "CustomerProfile_storeId_normalizedPhone_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_provider_externalCustomerId_key" ON "CustomerProfile"("workspaceId", "provider", "externalCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_normalizedEmail_key" ON "CustomerProfile"("workspaceId", "normalizedEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_normalizedPhone_key" ON "CustomerProfile"("workspaceId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_lastOrderAt_idx" ON "CustomerProfile"("workspaceId", "storeId", "lastOrderAt");

ALTER TABLE "CustomerOrder" DROP CONSTRAINT IF EXISTS "CustomerOrder_storeId_orderId_key";
DROP INDEX IF EXISTS "CustomerOrder_storeId_orderId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_provider_orderId_key" ON "CustomerOrder"("workspaceId", "provider", "orderId");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_orderCreatedAt_idx" ON "CustomerOrder"("workspaceId", "storeId", "orderCreatedAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_normalizedPhone_idx" ON "CustomerOrder"("workspaceId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_orderNumber_idx" ON "CustomerOrder"("workspaceId", "storeId", "orderNumber");

CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_storeId_normalizedName_idx" ON "CustomerOrderItem"("workspaceId", "storeId", "normalizedName");
CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_storeId_productId_idx" ON "CustomerOrderItem"("workspaceId", "storeId", "productId");
CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_orderId_idx" ON "CustomerOrderItem"("workspaceId", "orderId");
CREATE INDEX IF NOT EXISTS "CustomerSyncLog_workspaceId_storeId_status_startedAt_idx" ON "CustomerSyncLog"("workspaceId", "storeId", "status", "startedAt");

ALTER TABLE "EnboxShipment" DROP CONSTRAINT IF EXISTS "EnboxShipment_didEnvio_key";
DROP INDEX IF EXISTS "EnboxShipment_didEnvio_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_didEnvio_key" ON "EnboxShipment"("workspaceId", "didEnvio");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_orderNumber_idx" ON "EnboxShipment"("workspaceId", "orderNumber");
CREATE INDEX IF NOT EXISTS "EnboxSyncLog_workspaceId_status_startedAt_idx" ON "EnboxSyncLog"("workspaceId", "status", "startedAt");

ALTER TABLE "WhatsAppTemplate" DROP CONSTRAINT IF EXISTS "WhatsAppTemplate_metaTemplateId_key";
ALTER TABLE "WhatsAppTemplate" DROP CONSTRAINT IF EXISTS "WhatsAppTemplate_wabaId_name_language_key";
DROP INDEX IF EXISTS "WhatsAppTemplate_metaTemplateId_key";
DROP INDEX IF EXISTS "WhatsAppTemplate_wabaId_name_language_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_wabaId_name_language_key" ON "WhatsAppTemplate"("workspaceId", "wabaId", "name", "language");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_metaTemplateId_key" ON "WhatsAppTemplate"("workspaceId", "metaTemplateId");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_name_idx" ON "WhatsAppTemplate"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "TemplateSyncLog_workspaceId_startedAt_idx" ON "TemplateSyncLog"("workspaceId", "startedAt");

CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_status_createdAt_idx" ON "Campaign"("workspaceId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_dispatchLockedAt_idx" ON "Campaign"("workspaceId", "dispatchLockedAt");
ALTER TABLE "CampaignRecipient" DROP CONSTRAINT IF EXISTS "CampaignRecipient_waMessageId_key";
DROP INDEX IF EXISTS "CampaignRecipient_waMessageId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_waMessageId_key" ON "CampaignRecipient"("workspaceId", "waMessageId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_campaignId_status_idx" ON "CampaignRecipient"("workspaceId", "campaignId", "status");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_phone_idx" ON "CampaignRecipient"("workspaceId", "phone");

-- Foreign keys
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBranding" ADD CONSTRAINT "WorkspaceBranding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceAiConfig" ADD CONSTRAINT "WorkspaceAiConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceConnection" ADD CONSTRAINT "CommerceConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsConnection" ADD CONSTRAINT "LogisticsConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiLabRun" ADD CONSTRAINT "AiLabRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMenuSetting" ADD CONSTRAINT "WhatsAppMenuSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreInstallation" ADD CONSTRAINT "StoreInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CatalogSyncLog" ADD CONSTRAINT "CatalogSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AbandonedCart" ADD CONSTRAINT "AbandonedCart_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerOrderItem" ADD CONSTRAINT "CustomerOrderItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSyncLog" ADD CONSTRAINT "CustomerSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnboxShipment" ADD CONSTRAINT "EnboxShipment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnboxSyncLog" ADD CONSTRAINT "EnboxSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TemplateSyncLog" ADD CONSTRAINT "TemplateSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
