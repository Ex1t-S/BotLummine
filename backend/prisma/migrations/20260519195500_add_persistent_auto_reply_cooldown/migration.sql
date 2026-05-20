ALTER TABLE "ConversationState"
ADD COLUMN IF NOT EXISTS "pendingAutoReplyMessageId" TEXT,
ADD COLUMN IF NOT EXISTS "pendingAutoReplyDueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "pendingAutoReplyLockedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ConversationState_pendingAutoReplyDueAt_idx"
ON "ConversationState"("pendingAutoReplyDueAt");
