import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';

export const MENU_REPEAT_WINDOW_MS = 60_000;

export async function reserveMenuPrompt(client, { workspaceId, conversationId, menuPath, now = new Date() }) {
	requireWorkspaceScope(workspaceId);
	if (!conversationId || !menuPath) throw new Error('Menu reservation requires conversation and menu');
	return client.$transaction(async (tx) => {
		// Serialize only the short reservation, never hold a transaction during a Meta request.
		const rows = await tx.$queryRaw`SELECT id FROM "Conversation"
			WHERE id = ${conversationId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
		if (!rows.length) throw new Error('Conversation not found in workspace');
		const since = new Date(now.getTime() - MENU_REPEAT_WINDOW_MS);
		const recent = await tx.conversationEvent.findFirst({ where: {
			workspaceId, conversationId, eventType: { in: ['MENU_SEND_RESERVED', 'MENU_PROMPTED'] },
			createdAt: { gt: since }, metadata: { path: ['menuPath'], equals: menuPath },
		}, select: { id: true } });
		if (recent) return false;
		await tx.conversationEvent.create({ data: {
			workspaceId, conversationId, eventType: 'MENU_SEND_RESERVED',
			reason: 'prevent_repeated_menu', metadata: { menuPath }, createdAt: now,
		} });
		// Retain the reservation even after uncertain delivery; do not immediately retry a possible send.
		return true;
	});
}
