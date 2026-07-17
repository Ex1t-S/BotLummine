-- Additive observability storage. It intentionally excludes prompt and message content.
CREATE TABLE "AiTurnTrace" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "inboundMessageId" TEXT,
    "promptVersion" TEXT,
    "promptHash" TEXT,
    "route" TEXT NOT NULL,
    "intentName" TEXT,
    "intentConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retrievedFacts" JSONB NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "auditPassed" BOOLEAN NOT NULL DEFAULT true,
    "auditFlags" JSONB NOT NULL,
    "handoffReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTurnTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiTurnTrace_traceId_key" ON "AiTurnTrace"("traceId");
CREATE INDEX "AiTurnTrace_workspaceId_createdAt_idx" ON "AiTurnTrace"("workspaceId", "createdAt");
CREATE INDEX "AiTurnTrace_workspaceId_conversationId_createdAt_idx" ON "AiTurnTrace"("workspaceId", "conversationId", "createdAt");
CREATE INDEX "AiTurnTrace_inboundMessageId_idx" ON "AiTurnTrace"("inboundMessageId");
CREATE INDEX "AiTurnTrace_expiresAt_idx" ON "AiTurnTrace"("expiresAt");

ALTER TABLE "AiTurnTrace"
ADD CONSTRAINT "AiTurnTrace_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiTurnTrace"
ADD CONSTRAINT "AiTurnTrace_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiTurnTrace"
ADD CONSTRAINT "AiTurnTrace_inboundMessageId_fkey"
FOREIGN KEY ("inboundMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
