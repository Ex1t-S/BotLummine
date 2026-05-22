ALTER TABLE "AbandonedCartAutomationSetting"
ADD COLUMN IF NOT EXISTS "variableMapping" JSONB;

ALTER TABLE "AbandonedCartAutomationSetting"
ADD COLUMN IF NOT EXISTS "manualVariables" JSONB;
