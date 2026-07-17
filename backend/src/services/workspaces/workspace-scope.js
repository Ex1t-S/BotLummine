function requiredIdentifier(value, fieldName) {
	const normalized = String(value || '').trim();
	if (!normalized) {
		const error = new Error(`${fieldName} is required for a workspace-scoped lookup`);
		error.code = 'WORKSPACE_SCOPE_REQUIRED';
		throw error;
	}
	return normalized;
}

export function requireWorkspaceScope(workspaceId) {
	return requiredIdentifier(workspaceId, 'workspaceId');
}

export function workspaceOwnedWhere({ id, workspaceId, ...constraints } = {}) {
	return {
		id: requiredIdentifier(id, 'id'),
		workspaceId: requireWorkspaceScope(workspaceId),
		...constraints,
	};
}

export function adminManagedUserWhere({ userId, workspaceId, platformAdmin = false } = {}) {
	const id = requiredIdentifier(userId, 'userId');
	if (platformAdmin) return { id };
	return workspaceOwnedWhere({ id, workspaceId });
}

export async function findWorkspaceOwnedRecord(
	modelDelegate,
	{ id, workspaceId, select, include } = {},
) {
	if (!modelDelegate?.findFirst) {
		throw new TypeError('A Prisma-compatible model delegate is required');
	}

	return modelDelegate.findFirst({
		where: workspaceOwnedWhere({ id, workspaceId }),
		...(select ? { select } : {}),
		...(include ? { include } : {}),
	});
}

export function whatsAppTemplateWebhookWhere({ metaTemplateId, wabaId } = {}) {
	return {
		metaTemplateId: requiredIdentifier(metaTemplateId, 'metaTemplateId'),
		wabaId: requiredIdentifier(wabaId, 'wabaId'),
	};
}

export function workspaceIdsWhere(workspaceIds = []) {
	const normalizedIds = [
		...new Set(
			(Array.isArray(workspaceIds) ? workspaceIds : [])
				.map((workspaceId) => String(workspaceId || '').trim())
				.filter(Boolean),
		),
	];

	return { workspaceId: { in: normalizedIds } };
}

export function conversationStateForWorkspaceWhere({
	conversationId,
	workspaceId,
	...constraints
} = {}) {
	return {
		conversationId: requiredIdentifier(conversationId, 'conversationId'),
		conversation: {
			is: {
				workspaceId: requiredIdentifier(workspaceId, 'workspaceId'),
			},
		},
		...constraints,
	};
}

export async function findInboundMessageForWorkspace(prismaClient, { id, workspaceId } = {}) {
	if (!prismaClient?.message?.findFirst) {
		throw new TypeError('A Prisma-compatible message client is required');
	}

	return prismaClient.message.findFirst({
		where: workspaceOwnedWhere({ id, workspaceId, direction: 'INBOUND' }),
		include: {
			conversation: {
				include: {
					contact: true,
					state: true,
				},
			},
		},
	});
}

export async function findConversationForWorkspace(
	prismaClient,
	{ id, workspaceId, include } = {},
) {
	if (!prismaClient?.conversation?.findFirst) {
		throw new TypeError('A Prisma-compatible conversation client is required');
	}

	return prismaClient.conversation.findFirst({
		where: workspaceOwnedWhere({ id, workspaceId }),
		...(include ? { include } : {}),
	});
}
