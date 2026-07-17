function requiredIdentifier(value, fieldName) {
	const normalized = String(value || '').trim();
	if (!normalized) {
		const error = new Error(`${fieldName} is required for a workspace-scoped lookup`);
		error.code = 'WORKSPACE_SCOPE_REQUIRED';
		throw error;
	}
	return normalized;
}

export function workspaceOwnedWhere({ id, workspaceId, ...constraints } = {}) {
	return {
		id: requiredIdentifier(id, 'id'),
		workspaceId: requiredIdentifier(workspaceId, 'workspaceId'),
		...constraints,
	};
}

export function whatsAppTemplateWebhookWhere({ metaTemplateId, wabaId } = {}) {
	return {
		metaTemplateId: requiredIdentifier(metaTemplateId, 'metaTemplateId'),
		wabaId: requiredIdentifier(wabaId, 'wabaId'),
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
