CREATE TABLE "CampaignConversion" (
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

CREATE UNIQUE INDEX "CampaignConversion_workspaceId_conversionKey_key" ON "CampaignConversion"("workspaceId", "conversionKey");
CREATE INDEX "CampaignConversion_workspaceId_campaignId_source_idx" ON "CampaignConversion"("workspaceId", "campaignId", "source");
CREATE INDEX "CampaignConversion_workspaceId_recipientId_idx" ON "CampaignConversion"("workspaceId", "recipientId");
CREATE INDEX "CampaignConversion_workspaceId_orderId_idx" ON "CampaignConversion"("workspaceId", "orderId");
CREATE INDEX "CampaignConversion_workspaceId_checkoutId_idx" ON "CampaignConversion"("workspaceId", "checkoutId");
CREATE INDEX "CampaignConversion_workspaceId_convertedAt_idx" ON "CampaignConversion"("workspaceId", "convertedAt");

ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignConversion" ADD CONSTRAINT "CampaignConversion_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
