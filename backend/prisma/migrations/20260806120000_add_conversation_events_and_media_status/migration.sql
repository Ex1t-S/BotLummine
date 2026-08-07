ALTER TABLE "ConversationState"
    ADD COLUMN "humanLockMode" TEXT,
    ADD COLUMN "humanLockedAt" TIMESTAMP(3),
    ADD COLUMN "humanReleasedAt" TIMESTAMP(3),
    ADD COLUMN "humanAutoResumeAt" TIMESTAMP(3),
    ADD COLUMN "menuInvalidAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Message"
    ADD COLUMN "attachmentStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN "attachmentMetaId" TEXT,
    ADD COLUMN "attachmentStorageKey" TEXT,
    ADD COLUMN "attachmentSha256" TEXT;

UPDATE "Message"
SET
    "attachmentStatus" = 'UNRECOVERABLE',
    "attachmentMetaId" = COALESCE("rawPayload"->'attachment'->>'id', "rawPayload"->'message'->'image'->>'id', "rawPayload"->'message'->'sticker'->>'id'),
    "attachmentStorageKey" = "rawPayload"->'attachment'->>'storageFileName',
    "attachmentSha256" = COALESCE("rawPayload"->'attachment'->>'sha256', "rawPayload"->'message'->'image'->>'sha256', "rawPayload"->'message'->'sticker'->>'sha256')
WHERE "direction" = 'INBOUND'
  AND (
    "rawPayload"->'attachment'->>'id' IS NOT NULL
    OR "rawPayload"->'message'->'image'->>'id' IS NOT NULL
    OR "rawPayload"->'message'->'sticker'->>'id' IS NOT NULL
  );

CREATE TABLE "ConversationEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorUserId" TEXT,
    "fromQueue" "ConversationQueue",
    "toQueue" "ConversationQueue",
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationEvent_workspaceId_idempotencyKey_key"
    ON "ConversationEvent"("workspaceId", "idempotencyKey");

CREATE INDEX "ConversationEvent_workspaceId_conversationId_createdAt_idx"
    ON "ConversationEvent"("workspaceId", "conversationId", "createdAt");

CREATE INDEX "ConversationEvent_workspaceId_eventType_createdAt_idx"
    ON "ConversationEvent"("workspaceId", "eventType", "createdAt");

ALTER TABLE "ConversationEvent"
    ADD CONSTRAINT "ConversationEvent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationEvent"
    ADD CONSTRAINT "ConversationEvent_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationEvent"
    ADD CONSTRAINT "ConversationEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
