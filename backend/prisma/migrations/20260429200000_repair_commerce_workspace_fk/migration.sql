DO $$
DECLARE
  fallback_workspace_id TEXT;
BEGIN
  SELECT "id"
  INTO fallback_workspace_id
  FROM "Workspace"
  ORDER BY "createdAt" ASC NULLS LAST, "id" ASC
  LIMIT 1;

  IF fallback_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Cannot repair commerce workspace ids because Workspace has no rows';
  END IF;

  UPDATE "AbandonedCart" cart
  SET "workspaceId" = fallback_workspace_id
  WHERE cart."workspaceId" IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "Workspace" workspace WHERE workspace."id" = cart."workspaceId"
     );

  UPDATE "CustomerProfile" profile
  SET "workspaceId" = fallback_workspace_id
  WHERE profile."workspaceId" IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "Workspace" workspace WHERE workspace."id" = profile."workspaceId"
     );

  UPDATE "CustomerOrder" customer_order
  SET "workspaceId" = fallback_workspace_id
  WHERE customer_order."workspaceId" IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "Workspace" workspace WHERE workspace."id" = customer_order."workspaceId"
     );

  UPDATE "CustomerOrderItem" order_item
  SET "workspaceId" = fallback_workspace_id
  WHERE order_item."workspaceId" IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "Workspace" workspace WHERE workspace."id" = order_item."workspaceId"
     );

  UPDATE "CustomerSyncLog" sync_log
  SET "workspaceId" = fallback_workspace_id
  WHERE sync_log."workspaceId" IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM "Workspace" workspace WHERE workspace."id" = sync_log."workspaceId"
     );
END $$;
