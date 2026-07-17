CREATE TYPE "PaymentReviewActionType" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_NEW_PROOF', 'HANDOFF');

CREATE TABLE "PaymentReviewAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "PaymentReviewActionType" NOT NULL,
    "previousQueue" "ConversationQueue" NOT NULL,
    "resultQueue" "ConversationQueue" NOT NULL,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReviewAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentReviewAction_workspaceId_idempotencyKey_key"
    ON "PaymentReviewAction"("workspaceId", "idempotencyKey");

CREATE INDEX "PaymentReviewAction_workspaceId_conversationId_createdAt_idx"
    ON "PaymentReviewAction"("workspaceId", "conversationId", "createdAt");

CREATE INDEX "PaymentReviewAction_workspaceId_action_createdAt_idx"
    ON "PaymentReviewAction"("workspaceId", "action", "createdAt");

ALTER TABLE "PaymentReviewAction"
    ADD CONSTRAINT "PaymentReviewAction_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentReviewAction"
    ADD CONSTRAINT "PaymentReviewAction_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentReviewAction"
    ADD CONSTRAINT "PaymentReviewAction_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
