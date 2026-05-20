ALTER TABLE "ConversationState"
ADD COLUMN IF NOT EXISTS "campaignContext" JSONB;
