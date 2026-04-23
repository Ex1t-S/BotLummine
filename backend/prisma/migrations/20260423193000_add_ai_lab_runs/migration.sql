-- CreateTable
CREATE TABLE "AiLabRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fixtureKey" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "action" TEXT,
    "selectionId" TEXT,
    "userMessage" TEXT,
    "assistantMessage" TEXT,
    "intent" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "tracePayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLabRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiLabRun_sessionId_createdAt_idx" ON "AiLabRun"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiLabRun_conversationId_createdAt_idx" ON "AiLabRun"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiLabRun_fixtureKey_createdAt_idx" ON "AiLabRun"("fixtureKey", "createdAt");

-- AddForeignKey
ALTER TABLE "AiLabRun" ADD CONSTRAINT "AiLabRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
