ALTER TABLE "Conversation"
ADD COLUMN "lastInboundMessageAt" TIMESTAMP(3),
ADD COLUMN "lastReadAt" TIMESTAMP(3),
ADD COLUMN "unreadCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Conversation_unreadCount_lastMessageAt_idx"
ON "Conversation"("unreadCount", "lastMessageAt");
