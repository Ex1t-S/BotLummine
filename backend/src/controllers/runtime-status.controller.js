import { prisma } from '../lib/prisma.js';
import { requireRequestWorkspaceId } from '../services/workspaces/workspace-context.service.js';
import { listWorkspaceFeatureFlags } from '../services/workspaces/workspace-feature-flags.service.js';
import { isAutomationDispatchPaused, getAutomationContactWindow } from '../services/campaigns/campaign-dispatcher.service.js';

export function createRuntimeStatusHandler({ db = prisma, listFlags = listWorkspaceFeatureFlags } = {}) {
return async function getRuntimeStatus(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req, { allowDefaultForPlatformAdmin: false });
		const [flags, channel] = await Promise.all([
			listFlags(workspaceId),
			db.whatsAppChannel.findFirst({ where: { workspaceId, status: 'ACTIVE' }, select: { id: true } }),
		]);
		const enabled = key => flags.find(flag => flag.key === key)?.enabled === true;
		res.setHeader('Cache-Control', 'no-store');
		return res.json({ workspaceId, updatedAt: new Date().toISOString(),
			// This is configuration/permission, not a live Meta connectivity check.
			channelConfigured: Boolean(channel), connectivity: 'UNVERIFIED',
			outboundEnabled: enabled('whatsapp_outbound'),
			autoRepliesEnabled: enabled('ai_auto_replies') && String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true',
			automationEnabled: enabled('automation_dispatch') && enabled('campaign_dispatch'),
			pausedFlags: flags.filter(flag => !flag.enabled).map(({ key, reason }) => ({ key, reason })),
			quietHoursPaused: isAutomationDispatchPaused(),
			quietHours: getAutomationContactWindow(),
			timezone: process.env.CAMPAIGN_AUTOMATION_TIMEZONE || 'America/Argentina/Buenos_Aires',
		});
	} catch (error) { next(error); }
};
}

export const getRuntimeStatus = createRuntimeStatusHandler();
