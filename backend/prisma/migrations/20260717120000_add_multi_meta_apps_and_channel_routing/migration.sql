CREATE TABLE "WhatsAppApp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessManagerId" TEXT,
    "metaAppId" TEXT NOT NULL,
    "embeddedSignupConfigId" TEXT NOT NULL,
    "callbackKey" TEXT NOT NULL,
    "appSecret" TEXT NOT NULL,
    "verifyToken" TEXT NOT NULL,
    "graphVersion" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppApp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppApp_metaAppId_key" ON "WhatsAppApp"("metaAppId");
CREATE UNIQUE INDEX "WhatsAppApp_callbackKey_key" ON "WhatsAppApp"("callbackKey");
CREATE INDEX "WhatsAppApp_workspaceId_status_idx" ON "WhatsAppApp"("workspaceId", "status");

ALTER TABLE "WhatsAppChannel" ADD COLUMN "whatsappAppId" TEXT;
ALTER TABLE "WhatsAppChannel" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "WhatsAppChannel_whatsappAppId_status_idx" ON "WhatsAppChannel"("whatsappAppId", "status");

ALTER TABLE "Conversation" ADD COLUMN "whatsappChannelId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "routingKey" TEXT;

UPDATE "Conversation"
SET "routingKey" = CONCAT("workspaceId", ':legacy:', "contactId")
WHERE "routingKey" IS NULL;

ALTER TABLE "Conversation" ALTER COLUMN "routingKey" SET NOT NULL;
DROP INDEX IF EXISTS "Conversation_workspaceId_contactId_key";
CREATE UNIQUE INDEX "Conversation_routingKey_key" ON "Conversation"("routingKey");
CREATE INDEX "Conversation_workspaceId_contactId_whatsappChannelId_idx"
  ON "Conversation"("workspaceId", "contactId", "whatsappChannelId");

ALTER TABLE "Message" ADD COLUMN "whatsappChannelId" TEXT;

ALTER TABLE "WhatsAppApp"
  ADD CONSTRAINT "WhatsAppApp_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppChannel"
  ADD CONSTRAINT "WhatsAppChannel_whatsappAppId_fkey"
  FOREIGN KEY ("whatsappAppId") REFERENCES "WhatsAppApp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_whatsappChannelId_fkey"
  FOREIGN KEY ("whatsappChannelId") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_whatsappChannelId_fkey"
  FOREIGN KEY ("whatsappChannelId") REFERENCES "WhatsAppChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
