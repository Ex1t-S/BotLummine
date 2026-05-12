CREATE INDEX "Conversation_workspaceId_archivedAt_queue_lastMessageAt_idx"
ON "Conversation"("workspaceId", "archivedAt", "queue", "lastMessageAt");
