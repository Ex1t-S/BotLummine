import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const { prisma } = await import('../src/lib/prisma.js');
const { normalizeWhatsAppIdentityPhone } = await import('../src/lib/phone-normalization.js');
const { getTemplateOrThrow } = await import('../src/services/whatsapp/whatsapp-template.service.js');
const {
	claimNextCampaignForDispatch,
	dispatchCampaignBatch,
	launchCampaign,
} = await import('../src/services/campaigns/whatsapp-campaign.service.js');

const WORKSPACE_ID = 'workspace_lummine';
const RECOVERY_DATE = '2026-08-02';
const ERROR_CODE = '131048';
const RECOVERY_RUN_KEY = `${ERROR_CODE}:${RECOVERY_DATE}`;
const START_AT = new Date('2026-08-02T03:00:00.000Z');
const END_AT = new Date('2026-08-03T03:00:00.000Z');
const BATCH_SIZE = 5;
const SEND_DELAY_MS = 2_000;
const BATCH_COOLDOWN_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isDryRun = process.argv.includes('--dry-run');

function compactError(error) {
	return error?.message || String(error || 'Error desconocido');
}

function sourceKind(templateName) {
	if (templateName === 'carrito_5off') return 'abandoned_carts';
	if (templateName === 'pendientes_recuperacion') return 'pending_payment';
	return null;
}

function summarizeTargets(rows) {
	const summary = {};
	for (const row of rows) {
		const kind = sourceKind(row.campaign?.templateName) || row.campaign?.templateName || 'unknown';
		if (!summary[kind]) {
			summary[kind] = { total: 0, pending: 0, skipped: 0, sourceCampaigns: new Set() };
		}
		const item = summary[kind];
		item.total += 1;
		if (row.recoveryStatus === 'PENDING') item.pending += 1;
		if (row.recoveryStatus === 'SKIPPED') item.skipped += 1;
		if (row.campaignId) item.sourceCampaigns.add(row.campaignId);
	}
	return Object.fromEntries(
		Object.entries(summary).map(([key, value]) => [key, {
			...value,
			sourceCampaigns: [...value.sourceCampaigns],
		}])
	);
}

async function loadPreflight() {
	const [workspace, settings, flags, channels, templates, activeCampaigns] = await Promise.all([
		prisma.workspace.findUnique({
			where: { id: WORKSPACE_ID },
			select: { id: true, slug: true, name: true, status: true },
		}),
		prisma.$transaction([
			prisma.abandonedCartAutomationSetting.findUnique({ where: { workspaceId: WORKSPACE_ID } }),
			prisma.pendingPaymentAutomationSetting.findUnique({ where: { workspaceId: WORKSPACE_ID } }),
		]),
		prisma.workspaceFeatureFlag.findMany({
			where: { workspaceId: WORKSPACE_ID },
			select: { key: true, enabled: true },
		}),
		prisma.whatsAppChannel.findMany({
			where: { workspaceId: WORKSPACE_ID },
			select: { id: true, status: true, wabaId: true, isPrimary: true },
		}),
		prisma.whatsAppTemplate.findMany({
			where: {
				workspaceId: WORKSPACE_ID,
				name: { in: ['carrito_5off', 'pendientes_recuperacion'] },
				language: 'es_AR',
				deletedAt: null,
			},
			select: { id: true, name: true, language: true, status: true, wabaId: true, metaTemplateId: true },
		}),
		prisma.campaign.findMany({
			where: { workspaceId: WORKSPACE_ID, status: { in: ['QUEUED', 'RUNNING'] } },
			select: { id: true, name: true, status: true, automationRun: { select: { type: true, runKey: true } } },
		}),
	]);

	if (!workspace || workspace.status !== 'ACTIVE') {
		throw new Error('El workspace LUMMINE no existe o no está ACTIVE.');
	}
	if (!settings[0] || !settings[1]) {
		throw new Error('Falta la configuración persistente de una automatización.');
	}
	for (const key of ['campaign_dispatch', 'automation_dispatch', 'whatsapp_outbound']) {
		const row = flags.find((flag) => flag.key === key);
		if (row?.enabled === false) {
			throw new Error(`El feature flag ${key} está deshabilitado.`);
		}
	}
	if (!channels.some((channel) => channel.status === 'ACTIVE')) {
		throw new Error('No hay un canal activo de WhatsApp para LUMMINE.');
	}
	for (const name of ['carrito_5off', 'pendientes_recuperacion']) {
		const template = templates.find((item) => item.name === name);
		if (!template || template.status !== 'APPROVED') {
			throw new Error(`La plantilla ${name} no está APPROVED.`);
		}
		if (!channels.some((channel) => channel.status === 'ACTIVE' && channel.wabaId === template.wabaId)) {
			throw new Error(`La plantilla ${name} no coincide con ningún WABA activo.`);
		}
	}
	const foreignActiveCampaigns = activeCampaigns.filter(
		(campaign) => campaign.automationRun?.type !== 'quota_recovery' || campaign.automationRun?.runKey !== RECOVERY_RUN_KEY
	);
	if (foreignActiveCampaigns.length) {
		throw new Error(`Hay ${foreignActiveCampaigns.length} campañas ajenas activas; se cancela para evitar mezclar despachos.`);
	}

	return { workspace, settings, flags, channels, templates };
}

async function loadQuotaFailures() {
	const failures = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			status: 'FAILED',
			errorCode: ERROR_CODE,
			failedAt: { gte: START_AT, lt: END_AT },
		},
		select: {
			id: true,
			campaignId: true,
			phone: true,
			waId: true,
			contactId: true,
			contactName: true,
			externalKey: true,
			variables: true,
			renderedComponents: true,
			renderedPreviewText: true,
			failedAt: true,
			campaign: {
				select: {
					templateLocalId: true,
					templateName: true,
					templateLanguage: true,
					templateCategory: true,
					defaultComponents: true,
				},
			},
		},
		orderBy: { failedAt: 'desc' },
	});

	const latestByPhone = new Map();
	for (const row of failures) {
		const phone = normalizeWhatsAppIdentityPhone(row.phone || row.waId || '');
		if (!phone || !sourceKind(row.campaign?.templateName)) continue;
		if (!latestByPhone.has(phone)) {
			latestByPhone.set(phone, { ...row, normalizedPhone: phone });
		}
	}

	const targets = [...latestByPhone.values()];
	const contacts = await prisma.contact.findMany({
		where: { workspaceId: WORKSPACE_ID, waId: { in: targets.map((row) => row.normalizedPhone) } },
		select: { id: true, waId: true, name: true, marketingOptIn: true, marketingOptedOutAt: true },
	});
	const contactByPhone = new Map(contacts.map((contact) => [contact.waId, contact]));

	const recentSent = await prisma.campaignRecipient.findMany({
		where: {
			workspaceId: WORKSPACE_ID,
			phone: { in: targets.map((row) => row.normalizedPhone) },
			status: { in: ['SENT', 'DELIVERED', 'READ'] },
			sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
		},
		select: { phone: true },
	});
	const recentlySentPhones = new Set(recentSent.map((row) => normalizeWhatsAppIdentityPhone(row.phone || '')).filter(Boolean));

	for (const row of targets) {
		const contact = contactByPhone.get(row.normalizedPhone);
		const optedOut = contact?.marketingOptIn === false || Boolean(contact?.marketingOptedOutAt);
		const hasRecentSend = recentlySentPhones.has(row.normalizedPhone);
		row.recoveryStatus = optedOut || hasRecentSend ? 'SKIPPED' : 'PENDING';
		row.recoverySkipReason = optedOut ? 'marketing_opt_out' : hasRecentSend ? 'campaign_cooldown_24h' : null;
		row.currentContact = contact || null;
	}

	return { failures, targets };
}

async function getOrCreateRecoveryRun() {
	const existing = await prisma.automationRun.findUnique({
		where: {
			workspaceId_type_runKey: {
				workspaceId: WORKSPACE_ID,
				type: 'quota_recovery',
				runKey: RECOVERY_RUN_KEY,
			},
		},
		include: { campaigns: { orderBy: { createdAt: 'asc' } } },
	});
	if (existing) return existing;
	return prisma.automationRun.create({
		data: {
			workspaceId: WORKSPACE_ID,
			type: 'quota_recovery',
			runKey: RECOVERY_RUN_KEY,
			timezone: 'America/Argentina/Buenos_Aires',
			status: 'OPEN',
		},
		include: { campaigns: true },
	});
}

async function repairInterruptedLocalFailures(run) {
	if (!run?.campaigns?.length) return;
	const campaignIds = run.campaigns.map((campaign) => campaign.id);
	const repaired = await prisma.campaignRecipient.updateMany({
		where: {
			workspaceId: WORKSPACE_ID,
			campaignId: { in: campaignIds },
			status: 'FAILED',
			errorCode: null,
			errorMessage: { contains: 'SECRET_ENCRYPTION_KEY' },
		},
		data: { status: 'PENDING', errorMessage: null, failedAt: null },
	});

	for (const campaign of run.campaigns) {
		const grouped = await prisma.campaignRecipient.groupBy({
			by: ['status'],
			where: { workspaceId: WORKSPACE_ID, campaignId: campaign.id },
			_count: { _all: true },
		});
		const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
		const pending = Number(counts.PENDING || 0);
		await prisma.campaign.update({
			where: { id: campaign.id },
			data: {
				pendingRecipients: pending,
				failedRecipients: Number(counts.FAILED || 0),
				skippedRecipients: Number(counts.SKIPPED || 0),
				status: pending && ['QUEUED', 'RUNNING'].includes(campaign.status) ? 'QUEUED' : campaign.status,
				lastError: null,
				dispatchLockedAt: null,
				dispatchLockId: null,
				finishedAt: pending ? null : campaign.finishedAt,
			},
		});
	}
	if (repaired.count) {
		console.log(JSON.stringify({ action: 'repaired_local_failures', count: repaired.count }, null, 2));
	}
}

async function createRecoveryCampaign(run, templateName, targets, templateFallback) {
	const existing = run.campaigns.find((campaign) => campaign.templateName === templateName);
	if (existing) return existing;

	const template = await getTemplateOrThrow(templateFallback.id, { workspaceId: WORKSPACE_ID });
	if (template.status !== 'APPROVED') throw new Error(`La plantilla ${templateName} dejó de estar APPROVED.`);

	const sourceCampaignIds = [...new Set(targets.map((row) => row.campaignId))];
	const defaultComponents = targets.find((row) => Array.isArray(row.campaign?.defaultComponents))?.campaign?.defaultComponents
		|| template.rawPayload?.components
		|| [];
	const recipientRows = targets.map((row) => ({
		workspaceId: WORKSPACE_ID,
		phone: row.normalizedPhone,
		waId: row.normalizedPhone,
		contactId: row.contactId || row.currentContact?.id || null,
		contactName: row.contactName || row.currentContact?.name || row.normalizedPhone,
		externalKey: row.externalKey || `quota_recovery:${ERROR_CODE}:${RECOVERY_DATE}:${row.normalizedPhone}`,
		variables: {
			...(row.variables && typeof row.variables === 'object' ? row.variables : {}),
			recovery_source_campaign_id: row.campaignId,
			recovery_source_recipient_id: row.id,
		},
		renderedComponents: Array.isArray(row.renderedComponents) && row.renderedComponents.length
			? row.renderedComponents
			: defaultComponents,
		renderedPreviewText: row.renderedPreviewText || null,
		status: row.recoveryStatus,
		errorMessage: row.recoverySkipReason,
	}));
	const pendingRecipients = recipientRows.filter((row) => row.status === 'PENDING').length;
	const skippedRecipients = recipientRows.length - pendingRecipients;

	return prisma.campaign.create({
		data: {
			workspaceId: WORKSPACE_ID,
			name: `Recuperación límite ${ERROR_CODE} ${templateName} ${RECOVERY_DATE}`,
			templateLocalId: template.id,
			templateMetaId: template.metaTemplateId,
			templateName: template.name,
			templateLanguage: template.language,
			templateCategory: template.category,
			status: 'DRAFT',
			audienceSource: 'manual',
			notes: `Recuperación idempotente de fallos Meta ${ERROR_CODE} del ${RECOVERY_DATE}.`,
			totalRecipients: recipientRows.length,
			pendingRecipients,
			skippedRecipients,
			defaultComponents,
			draftContext: {
				type: 'quota_recovery',
				errorCode: ERROR_CODE,
				recoveryDate: RECOVERY_DATE,
				sourceCampaignIds,
				deduplicatedBy: 'normalized_phone_latest_failed_at',
			},
			automationRunId: run.id,
			recipients: { create: recipientRows },
		},
		include: { recipients: true },
	});
}

async function getCampaignSnapshot(campaignId) {
	return prisma.campaign.findFirst({
		where: { id: campaignId, workspaceId: WORKSPACE_ID },
		select: { id: true, name: true, status: true, totalRecipients: true, pendingRecipients: true, sentRecipients: true, deliveredRecipients: true, readRecipients: true, failedRecipients: true, skippedRecipients: true, lastError: true },
	});
}

async function hasQuotaFailure(campaignId) {
	return prisma.campaignRecipient.count({
		where: { workspaceId: WORKSPACE_ID, campaignId, status: 'FAILED', errorCode: ERROR_CODE },
	});
}

async function dispatchRecoveryCampaign(campaign) {
	let snapshot = await getCampaignSnapshot(campaign.id);
	if (!snapshot) throw new Error(`No se encontró la campaña de recuperación ${campaign.id}.`);

	if (snapshot.status === 'DRAFT' && snapshot.pendingRecipients > 0) {
		await launchCampaign(campaign.id, { workspaceId: WORKSPACE_ID });
	}

	while (true) {
		snapshot = await getCampaignSnapshot(campaign.id);
		if (!snapshot || snapshot.pendingRecipients === 0) return snapshot;

		const active = await prisma.campaign.findMany({
			where: { workspaceId: WORKSPACE_ID, status: { in: ['QUEUED', 'RUNNING'] } },
			select: { id: true, name: true },
		});
		const otherActive = active.filter((item) => item.id !== campaign.id);
		if (otherActive.length) {
			throw new Error(`Hay otra campaña activa durante la recuperación: ${otherActive[0].id}.`);
		}

		const claimed = await claimNextCampaignForDispatch();
		if (!claimed || claimed.campaignId !== campaign.id) {
			throw new Error('No se pudo reclamar exclusivamente la campaña de recuperación.');
		}

		process.env.CAMPAIGN_DISPATCH_BATCH_SIZE = String(BATCH_SIZE);
		process.env.CAMPAIGN_SEND_DELAY_MS = String(SEND_DELAY_MS);
		await dispatchCampaignBatch(campaign.id, claimed.lockId);

		const quotaFailures = await hasQuotaFailure(campaign.id);
		if (quotaFailures > 0) {
			throw new Error(`Meta volvió a responder ${ERROR_CODE}; se detuvo la recuperación con ${quotaFailures} fallo(s) de límite.`);
		}

		await sleep(BATCH_COOLDOWN_MS);
	}
}

async function enableAutomations() {
	await prisma.$transaction([
		prisma.abandonedCartAutomationSetting.update({
			where: { workspaceId: WORKSPACE_ID },
			data: { enabled: true, minCartAgeMinutes: 180, lastError: null },
		}),
		prisma.pendingPaymentAutomationSetting.update({
			where: { workspaceId: WORKSPACE_ID },
			data: { enabled: true, minOrderAgeMinutes: 180, lastError: null },
		}),
	]);
}

async function pauseAutomations() {
	await prisma.$transaction([
		prisma.abandonedCartAutomationSetting.update({
			where: { workspaceId: WORKSPACE_ID },
			data: { enabled: false, minCartAgeMinutes: 180 },
		}),
		prisma.pendingPaymentAutomationSetting.update({
			where: { workspaceId: WORKSPACE_ID },
			data: { enabled: false, minOrderAgeMinutes: 180 },
		}),
	]);
}

async function main() {
	const preflight = await loadPreflight();
	const { failures, targets } = await loadQuotaFailures();
	const summary = summarizeTargets(targets);
	console.log(JSON.stringify({
		mode: isDryRun ? 'dry-run' : 'execute',
		workspace: preflight.workspace,
		failureRows: failures.length,
		uniqueTargets: targets.length,
		targetSummary: summary,
		recoveryDate: RECOVERY_DATE,
		errorCode: ERROR_CODE,
	}, null, 2));

	if (!targets.length) {
		console.log('No hay destinatarios 131048 para recuperar.');
		return;
	}
	if (Object.keys(summary).some((key) => !['abandoned_carts', 'pending_payment'].includes(key))) {
		throw new Error('Se encontró una plantilla inesperada en los fallos seleccionados.');
	}
	if (isDryRun) return;

	await pauseAutomations();

	const run = await getOrCreateRecoveryRun();
	await repairInterruptedLocalFailures(run);
	const templateByName = new Map(preflight.templates.map((template) => [template.name, template]));
	const grouped = new Map();
	for (const target of targets) {
		const templateName = target.campaign.templateName;
		if (!grouped.has(templateName)) grouped.set(templateName, []);
		grouped.get(templateName).push(target);
	}

	const campaigns = [];
	for (const [templateName, group] of grouped) {
		campaigns.push(await createRecoveryCampaign(run, templateName, group, templateByName.get(templateName)));
	}
	await prisma.automationRun.update({
		where: { id: run.id },
		data: { status: 'QUEUED', lastRunAt: new Date(), runCount: { increment: 1 }, lastError: null },
	});

	for (const campaign of campaigns.sort((a, b) => a.templateName.localeCompare(b.templateName))) {
		console.log(JSON.stringify({ action: 'dispatch_start', campaignId: campaign.id, templateName: campaign.templateName, totalRecipients: campaign.totalRecipients }, null, 2));
		await dispatchRecoveryCampaign(campaign);
		console.log(JSON.stringify({ action: 'dispatch_finished', campaign: await getCampaignSnapshot(campaign.id) }, null, 2));
	}

	const remaining = await prisma.campaignRecipient.count({
		where: { workspaceId: WORKSPACE_ID, campaign: { automationRunId: run.id }, status: 'PENDING' },
	});
	const rateLimitFailures = await prisma.campaignRecipient.count({
		where: { workspaceId: WORKSPACE_ID, campaign: { automationRunId: run.id }, status: 'FAILED', errorCode: ERROR_CODE },
	});
	if (remaining || rateLimitFailures) {
		await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'FAILED', lastError: `Quedaron ${remaining} pendientes y ${rateLimitFailures} fallos ${ERROR_CODE}.` } });
		throw new Error(`La recuperación no terminó: ${remaining} pendientes, ${rateLimitFailures} fallos ${ERROR_CODE}. Las automatizaciones siguen pausadas.`);
	}

	await enableAutomations();
	await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', lastRunAt: new Date(), lastError: null } });
	console.log(JSON.stringify({ action: 'automations_enabled', workspaceId: WORKSPACE_ID, abandonedCarts: true, pendingPayments: true }, null, 2));
}

try {
	await main();
} catch (error) {
	console.error(JSON.stringify({ ok: false, error: compactError(error) }, null, 2));
	process.exitCode = 1;
} finally {
	await prisma.$disconnect();
}
