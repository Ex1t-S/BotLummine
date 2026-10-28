import { prisma } from '../../lib/prisma.js';
import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

export async function getInitialInboundRouting(workspaceId, { prismaClient = prisma } = {}) {
	const id = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const config = await prismaClient.workspaceAiConfig.findUnique({
		where: { workspaceId: id },
		select: { policyConfig: true },
	});
	const queue = config?.policyConfig?.defaultInboundQueue === 'AUTO' ? 'AUTO' : 'HUMAN';
	return { queue, aiEnabled: queue === 'AUTO' };
}
