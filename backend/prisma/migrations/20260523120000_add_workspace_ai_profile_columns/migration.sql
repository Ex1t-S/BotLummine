ALTER TABLE "WorkspaceAiConfig"
ADD COLUMN IF NOT EXISTS "aiProfile" TEXT NOT NULL DEFAULT 'GENERIC_ECOMMERCE';

ALTER TABLE "WorkspaceAiConfig"
ADD COLUMN IF NOT EXISTS "vertical" TEXT NOT NULL DEFAULT 'ECOMMERCE';

ALTER TABLE "WorkspaceAiConfig"
ALTER COLUMN "agentName" SET DEFAULT 'Asistente';

ALTER TABLE "WorkspaceAiConfig"
ALTER COLUMN "tone" SET DEFAULT 'humana, directa y util';

UPDATE "WorkspaceAiConfig" AS config
SET "aiProfile" = CASE
	WHEN UPPER(config."catalogConfig"->>'aiProfile') IN ('GENERIC_ECOMMERCE', 'LUMMINE_BODYWEAR', 'DKV_INSURANCE')
		THEN UPPER(config."catalogConfig"->>'aiProfile')
	WHEN LOWER(CONCAT_WS(' ', workspace."id", workspace."slug", workspace."name", config."businessName", config."businessContext", config."systemPrompt")) ~ '\y(dkv|seguros?|polizas?|aseguradora|vecindario|las palmas)\y'
		THEN 'DKV_INSURANCE'
	WHEN workspace."id" = 'workspace_lummine'
		OR LOWER(CONCAT_WS(' ', workspace."id", workspace."slug", workspace."name", config."businessName", config."businessContext", config."systemPrompt")) ~ '\ylummine\y'
		THEN 'LUMMINE_BODYWEAR'
	ELSE 'GENERIC_ECOMMERCE'
END
FROM "Workspace" AS workspace
WHERE config."workspaceId" = workspace."id";

UPDATE "WorkspaceAiConfig"
SET "vertical" = CASE
	WHEN UPPER("catalogConfig"->>'vertical') IN ('ECOMMERCE', 'INSURANCE')
		THEN UPPER("catalogConfig"->>'vertical')
	WHEN "aiProfile" = 'DKV_INSURANCE'
		THEN 'INSURANCE'
	ELSE 'ECOMMERCE'
END;

UPDATE "WorkspaceAiConfig"
SET "catalogConfig" = COALESCE("catalogConfig", '{}'::jsonb)
	|| jsonb_build_object(
		'aiProfile', "aiProfile",
		'vertical', "vertical"
	);
