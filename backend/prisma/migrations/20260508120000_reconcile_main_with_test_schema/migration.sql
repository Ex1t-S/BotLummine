-- Reconcile the production main schema with the test branch schema without
-- replacing or importing data. This migration assumes main may already have
-- the previous workspace repair migrations applied.

DO $$ BEGIN
    CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "WorkspaceStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE "WorkspaceStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

DO $$ BEGIN
    CREATE TYPE "CommerceProvider" AS ENUM ('TIENDANUBE', 'SHOPIFY');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "CommerceProvider" ADD VALUE IF NOT EXISTS 'SHOPIFY';

DO $$ BEGIN
    CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ERROR', 'PENDING');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "LogisticsProvider" AS ENUM ('ENBOX');
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

INSERT INTO "Workspace" ("id", "name", "slug", "status", "createdAt", "updatedAt")
VALUES ('workspace_lummine', 'Lummine', 'lummine', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "name" = EXCLUDED."name",
    "slug" = EXCLUDED."slug",
    "status" = EXCLUDED."status",
    "updatedAt" = CURRENT_TIMESTAMP;

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

-- Preserve existing role values while moving away from the old enum type.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
DO $$
BEGIN
    ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
    ALTER TABLE "User" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
    ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'AGENT';
EXCEPTION
    WHEN undefined_object THEN
        ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'AGENT';
END $$;

DROP TYPE IF EXISTS "UserRole";

UPDATE "User" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL AND "role" <> 'PLATFORM_ADMIN';
CREATE INDEX IF NOT EXISTS "User_workspaceId_role_idx" ON "User"("workspaceId", "role");

-- Tenant columns that were not covered by the older main workspace migrations.
ALTER TABLE "AiLabRun" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "AiLabRun" r SET "workspaceId" = COALESCE(c."workspaceId", 'workspace_lummine') FROM "Conversation" c WHERE r."conversationId" = c."id" AND r."workspaceId" IS NULL;
UPDATE "AiLabRun" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "AiLabRun" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "WhatsAppMenuSetting" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
UPDATE "WhatsAppMenuSetting" SET "workspaceId" = 'workspace_lummine' WHERE "workspaceId" IS NULL;
ALTER TABLE "WhatsAppMenuSetting" ALTER COLUMN "workspaceId" SET NOT NULL;

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

-- Remove runtime defaults from older main migrations where the final schema no longer has them.
ALTER TABLE "Contact" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "AbandonedCart" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "CustomerProfile" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "CustomerOrder" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "CustomerOrderItem" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "CustomerSyncLog" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "Campaign" ALTER COLUMN "workspaceId" DROP DEFAULT;
ALTER TABLE "CampaignRecipient" ALTER COLUMN "workspaceId" DROP DEFAULT;

-- Replace legacy global indexes with workspace-aware indexes. This preserves rows;
-- if duplicate data conflicts with a new unique index, the migration stops.
DROP INDEX IF EXISTS "Conversation_lastMessageAt_idx";
DROP INDEX IF EXISTS "Conversation_unreadCount_lastMessageAt_idx";
DROP INDEX IF EXISTS "Conversation_archivedAt_lastMessageAt_idx";
DROP INDEX IF EXISTS "Conversation_queue_aiEnabled_lastMessageAt_idx";
DROP INDEX IF EXISTS "AiLabRun_sessionId_createdAt_idx";
DROP INDEX IF EXISTS "AiLabRun_conversationId_createdAt_idx";
DROP INDEX IF EXISTS "AiLabRun_fixtureKey_createdAt_idx";
DROP INDEX IF EXISTS "WhatsAppMenuSetting_key_key";
DROP INDEX IF EXISTS "Message_conversationId_createdAt_idx";
DROP INDEX IF EXISTS "CatalogProduct_storeId_published_idx";
DROP INDEX IF EXISTS "CatalogProduct_name_idx";
DROP INDEX IF EXISTS "CatalogProduct_storeId_productId_key";
DROP INDEX IF EXISTS "AbandonedCart_checkoutId_key";
DROP INDEX IF EXISTS "AbandonedCart_status_updatedAt_idx";
DROP INDEX IF EXISTS "AbandonedCart_contactPhone_idx";
DROP INDEX IF EXISTS "AbandonedCart_storeId_checkoutCreatedAt_idx";
DROP INDEX IF EXISTS "AbandonedCart_storeId_updatedAt_idx";
DROP INDEX IF EXISTS "CustomerProfile_storeId_externalCustomerId_key";
DROP INDEX IF EXISTS "CustomerProfile_storeId_normalizedEmail_key";
DROP INDEX IF EXISTS "CustomerProfile_storeId_normalizedPhone_key";
DROP INDEX IF EXISTS "CustomerOrder_storeId_orderId_key";
DROP INDEX IF EXISTS "EnboxShipment_didEnvio_key";
DROP INDEX IF EXISTS "WhatsAppTemplate_metaTemplateId_key";
DROP INDEX IF EXISTS "WhatsAppTemplate_wabaId_name_language_key";
DROP INDEX IF EXISTS "CampaignRecipient_waMessageId_key";

CREATE INDEX IF NOT EXISTS "AiLabRun_workspaceId_sessionId_createdAt_idx" ON "AiLabRun"("workspaceId", "sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiLabRun_workspaceId_conversationId_createdAt_idx" ON "AiLabRun"("workspaceId", "conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiLabRun_workspaceId_fixtureKey_createdAt_idx" ON "AiLabRun"("workspaceId", "fixtureKey", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMenuSetting_workspaceId_key_key" ON "WhatsAppMenuSetting"("workspaceId", "key");
CREATE INDEX IF NOT EXISTS "WhatsAppMenuSetting_workspaceId_isActive_idx" ON "WhatsAppMenuSetting"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "StoreInstallation_workspaceId_provider_idx" ON "StoreInstallation"("workspaceId", "provider");
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_provider_productId_key" ON "CatalogProduct"("workspaceId", "provider", "productId");
CREATE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_storeId_published_idx" ON "CatalogProduct"("workspaceId", "storeId", "published");
CREATE INDEX IF NOT EXISTS "CatalogProduct_workspaceId_name_idx" ON "CatalogProduct"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "CatalogSyncLog_workspaceId_provider_startedAt_idx" ON "CatalogSyncLog"("workspaceId", "provider", "startedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_provider_checkoutId_key" ON "AbandonedCart"("workspaceId", "provider", "checkoutId");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_contactPhone_idx" ON "AbandonedCart"("workspaceId", "contactPhone");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_storeId_checkoutCreatedAt_idx" ON "AbandonedCart"("workspaceId", "storeId", "checkoutCreatedAt");
CREATE INDEX IF NOT EXISTS "AbandonedCart_workspaceId_storeId_updatedAt_idx" ON "AbandonedCart"("workspaceId", "storeId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_provider_externalCustomerId_key" ON "CustomerProfile"("workspaceId", "provider", "externalCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_normalizedEmail_key" ON "CustomerProfile"("workspaceId", "normalizedEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_normalizedPhone_key" ON "CustomerProfile"("workspaceId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_lastOrderAt_idx" ON "CustomerProfile"("workspaceId", "storeId", "lastOrderAt");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_firstOrderAt_idx" ON "CustomerProfile"("workspaceId", "storeId", "firstOrderAt");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_totalSpent_idx" ON "CustomerProfile"("workspaceId", "storeId", "totalSpent");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_lastOrderNumber_idx" ON "CustomerProfile"("workspaceId", "storeId", "lastOrderNumber");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_orderCount_idx" ON "CustomerProfile"("workspaceId", "storeId", "orderCount");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_normalizedPhone_idx" ON "CustomerProfile"("workspaceId", "storeId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "CustomerProfile_workspaceId_storeId_normalizedEmail_idx" ON "CustomerProfile"("workspaceId", "storeId", "normalizedEmail");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_provider_orderId_key" ON "CustomerOrder"("workspaceId", "provider", "orderId");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_normalizedEmail_idx" ON "CustomerOrder"("workspaceId", "normalizedEmail");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_normalizedPhone_idx" ON "CustomerOrder"("workspaceId", "normalizedPhone");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_orderNumber_idx" ON "CustomerOrder"("workspaceId", "storeId", "orderNumber");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_paymentStatus_orderCreate_idx" ON "CustomerOrder"("workspaceId", "storeId", "paymentStatus", "orderCreatedAt");
CREATE INDEX IF NOT EXISTS "CustomerOrder_workspaceId_storeId_shippingStatus_orderCreat_idx" ON "CustomerOrder"("workspaceId", "storeId", "shippingStatus", "orderCreatedAt");
CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_storeId_productId_idx" ON "CustomerOrderItem"("workspaceId", "storeId", "productId");
CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_storeId_orderNumber_idx" ON "CustomerOrderItem"("workspaceId", "storeId", "orderNumber");
CREATE INDEX IF NOT EXISTS "CustomerOrderItem_workspaceId_orderId_idx" ON "CustomerOrderItem"("workspaceId", "orderId");
CREATE UNIQUE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_didEnvio_key" ON "EnboxShipment"("workspaceId", "didEnvio");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_orderNumber_idx" ON "EnboxShipment"("workspaceId", "orderNumber");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_shipmentNumber_idx" ON "EnboxShipment"("workspaceId", "shipmentNumber");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_packId_idx" ON "EnboxShipment"("workspaceId", "packId");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_trackingNumber_idx" ON "EnboxShipment"("workspaceId", "trackingNumber");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_storeId_orderNumber_idx" ON "EnboxShipment"("workspaceId", "storeId", "orderNumber");
CREATE INDEX IF NOT EXISTS "EnboxShipment_workspaceId_lastSyncedAt_idx" ON "EnboxShipment"("workspaceId", "lastSyncedAt");
CREATE INDEX IF NOT EXISTS "EnboxSyncLog_workspaceId_status_startedAt_idx" ON "EnboxSyncLog"("workspaceId", "status", "startedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_wabaId_name_language_key" ON "WhatsAppTemplate"("workspaceId", "wabaId", "name", "language");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_metaTemplateId_key" ON "WhatsAppTemplate"("workspaceId", "metaTemplateId");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_name_idx" ON "WhatsAppTemplate"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_status_idx" ON "WhatsAppTemplate"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "WhatsAppTemplate_workspaceId_category_idx" ON "WhatsAppTemplate"("workspaceId", "category");
CREATE INDEX IF NOT EXISTS "TemplateSyncLog_workspaceId_startedAt_idx" ON "TemplateSyncLog"("workspaceId", "startedAt");
CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_dispatchLockedAt_idx" ON "Campaign"("workspaceId", "dispatchLockedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_waMessageId_key" ON "CampaignRecipient"("workspaceId", "waMessageId");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_workspaceId_phone_idx" ON "CampaignRecipient"("workspaceId", "phone");

CREATE TABLE IF NOT EXISTS "CampaignConversion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "recipientId" TEXT,
    "conversionKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "checkoutId" TEXT,
    "cartId" TEXT,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "amount" DECIMAL(12,2),
    "currency" TEXT,
    "paymentStatus" TEXT,
    "sentAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3) NOT NULL,
    "attributionWindowHours" INTEGER NOT NULL DEFAULT 168,
    "matchReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_conversionKey_key" ON "CampaignConversion"("workspaceId", "conversionKey");
CREATE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_campaignId_source_idx" ON "CampaignConversion"("workspaceId", "campaignId", "source");
CREATE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_recipientId_idx" ON "CampaignConversion"("workspaceId", "recipientId");
CREATE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_orderId_idx" ON "CampaignConversion"("workspaceId", "orderId");
CREATE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_checkoutId_idx" ON "CampaignConversion"("workspaceId", "checkoutId");
CREATE INDEX IF NOT EXISTS "CampaignConversion_workspaceId_convertedAt_idx" ON "CampaignConversion"("workspaceId", "convertedAt");

CREATE TABLE IF NOT EXISTS "CampaignSchedule" (
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

CREATE INDEX IF NOT EXISTS "CampaignSchedule_workspaceId_status_nextRunAt_idx" ON "CampaignSchedule"("workspaceId", "status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "CampaignSchedule_workspaceId_createdAt_idx" ON "CampaignSchedule"("workspaceId", "createdAt");

DO $$
BEGIN
    ALTER TABLE "WorkspaceBranding" ADD CONSTRAINT "WorkspaceBranding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "WorkspaceAiConfig" ADD CONSTRAINT "WorkspaceAiConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CommerceConnection" ADD CONSTRAINT "CommerceConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "LogisticsConnection" ADD CONSTRAINT "LogisticsConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "WhatsAppChannel" ADD CONSTRAINT "WhatsAppChannel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "AiLabRun" ADD CONSTRAINT "AiLabRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "WhatsAppMenuSetting" ADD CONSTRAINT "WhatsAppMenuSetting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "StoreInstallation" ADD CONSTRAINT "StoreInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CatalogSyncLog" ADD CONSTRAINT "CatalogSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "EnboxShipment" ADD CONSTRAINT "EnboxShipment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "EnboxSyncLog" ADD CONSTRAINT "EnboxSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "TemplateSyncLog" ADD CONSTRAINT "TemplateSyncLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "CampaignSchedule" ADD CONSTRAINT "CampaignSchedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
