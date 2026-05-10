ALTER TABLE "PendingPaymentAutomationSetting"
ADD COLUMN IF NOT EXISTS "variableMapping" JSONB;
