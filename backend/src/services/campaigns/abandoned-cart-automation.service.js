import { prisma } from '../../lib/prisma.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { syncAbandonedCarts } from '../carts/abandoned-cart.service.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import { filterRecoverableAbandonedCarts } from './campaign-attribution.service.js';
import { createCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';

const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_MIN_CART_AGE_MINUTES = 60;
const DEFAULT_FILTERS = {
	daysBack: 7,
	status: 'NEW',
	limit: 50,
	minTotal: null,
	productQuery: '',
};

function isAbandonedCartAutomationTableMissing(error) {
	return (
		error?.code === 'P2021' ||
		/AbandonedCartAutomationSetting|AbandonedCartAutomationLog|public\.AbandonedCartAutomation/i.test(
			String(error?.message || '')
		)
	);
}

async function ensureAbandonedCartAutomationTables(workspaceId = DEFAULT_WORKSPACE_ID) {
	try {
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "AbandonedCartAutomationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "filters" JSONB,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "minCartAgeMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AbandonedCartAutomationSetting_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "AbandonedCartAutomationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "templateName" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AbandonedCartAutomationLog_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCartAutomationSetting_workspaceId_key"
ON "AbandonedCartAutomationSetting"("workspaceId")`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_checkoutId_key"
ON "AbandonedCartAutomationLog"("workspaceId", "checkoutId")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_createdAt_idx"
ON "AbandonedCartAutomationLog"("workspaceId", "createdAt")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "AbandonedCartAutomationLog_workspaceId_campaignId_idx"
ON "AbandonedCartAutomationLog"("workspaceId", "campaignId")`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'AbandonedCartAutomationSetting_workspaceId_fkey'
	) THEN
		ALTER TABLE "AbandonedCartAutomationSetting"
		ADD CONSTRAINT "AbandonedCartAutomationSetting_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'AbandonedCartAutomationLog_workspaceId_fkey'
	) THEN
		ALTER TABLE "AbandonedCartAutomationLog"
		ADD CONSTRAINT "AbandonedCartAutomationLog_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		logger.warn('abandoned_cart_automation.tables_repaired', { workspaceId });
	} catch (repairError) {
		logger.error('abandoned_cart_automation.table_repair_failed', {
			workspaceId,
			error: repairError,
		});
		throw repairError;
	}
}

function normalizeString(value, fallback = '') {
	const normalized = String(value ?? '').trim();
	return normalized || fallback;
}

function normalizeBoolean(value) {
	if (typeof value === 'boolean') return value;
	const normalized = normalizeString(value).toLowerCase();
	return ['1', 'true', 'yes', 'on', 'si'].includes(normalized);
}

function normalizeFilters(input = {}) {
	const parsedMinTotal = Number(input.minTotal);
	const rawStatus = normalizeString(input.status || 'NEW').toUpperCase();

	return {
		daysBack: Math.max(1, Math.min(Number(input.daysBack || DEFAULT_FILTERS.daysBack) || DEFAULT_FILTERS.daysBack, 30)),
		status: rawStatus === 'NEW' ? 'NEW' : 'NEW',
		limit: Math.max(1, Math.min(Number(input.limit || DEFAULT_FILTERS.limit) || DEFAULT_FILTERS.limit, 500)),
		minTotal:
			input.minTotal === '' || input.minTotal === null || input.minTotal === undefined
				? null
				: Number.isFinite(parsedMinTotal)
					? parsedMinTotal
					: null,
		productQuery: normalizeString(input.productQuery || ''),
	};
}

function serializeSetting(setting = null) {
	const filters = normalizeFilters(setting?.filters || DEFAULT_FILTERS);
	return {
		enabled: Boolean(setting?.enabled),
		templateId: setting?.templateLocalId || '',
		templateName: setting?.templateName || '',
		templateLanguage: setting?.templateLanguage || 'es_AR',
		filters,
		intervalMinutes: DEFAULT_INTERVAL_MINUTES,
		minCartAgeMinutes: Number(setting?.minCartAgeMinutes || DEFAULT_MIN_CART_AGE_MINUTES),
		lastRunAt: setting?.lastRunAt || null,
		lastCampaignId: setting?.lastCampaignId || null,
		lastError: setting?.lastError || null,
		runCount: Number(setting?.runCount || 0),
	};
}

function subtractMinutes(minutes) {
	return new Date(Date.now() - Math.max(1, Number(minutes) || DEFAULT_MIN_CART_AGE_MINUTES) * 60 * 1000);
}

function subtractDays(days) {
	return new Date(Date.now() - Math.max(1, Number(days) || DEFAULT_FILTERS.daysBack) * 24 * 60 * 60 * 1000);
}

function getPrimaryProductName(cart = {}) {
	const product = Array.isArray(cart.products) ? cart.products[0] || {} : {};
	return normalizeString(product?.name || product?.title || product?.productName || product?.sku || '');
}

function cartMatchesProductQuery(cart = {}, productQuery = '') {
	const needle = normalizeString(productQuery).toLowerCase();
	if (!needle) return true;
	const products = Array.isArray(cart.products) ? cart.products : [];
	return products.some((product) =>
		normalizeString(product?.name || product?.title || product?.productName || product?.sku || '')
			.toLowerCase()
			.includes(needle)
	);
}

async function ensureSetting(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	let existing = null;

	try {
		existing = await prisma.abandonedCartAutomationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	} catch (error) {
		if (!isAbandonedCartAutomationTableMissing(error)) throw error;
		await ensureAbandonedCartAutomationTables(resolvedWorkspaceId);
		existing = await prisma.abandonedCartAutomationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	}

	if (existing) return existing;

	return prisma.abandonedCartAutomationSetting.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			enabled: false,
			filters: DEFAULT_FILTERS,
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minCartAgeMinutes: DEFAULT_MIN_CART_AGE_MINUTES,
		},
	});
}

export async function getAbandonedCartAutomationSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	return serializeSetting(await ensureSetting(workspaceId));
}

export async function updateAbandonedCartAutomationSettings({
	workspaceId = DEFAULT_WORKSPACE_ID,
	enabled = false,
	templateId = null,
	filters = {},
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const nextEnabled = normalizeBoolean(enabled);
	const current = await ensureSetting(resolvedWorkspaceId);
	let template = current?.templateLocalId
		? {
				id: current.templateLocalId,
				name: current.templateName,
				language: current.templateLanguage,
			}
		: null;

	if (templateId) {
		template = await getTemplateOrThrow(templateId, { workspaceId: resolvedWorkspaceId });
	}

	if (nextEnabled && !template) {
		throw new Error('Elegi una plantilla antes de activar la automatizacion de carritos.');
	}

	const setting = await prisma.abandonedCartAutomationSetting.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		create: {
			workspaceId: resolvedWorkspaceId,
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: normalizeFilters(filters),
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minCartAgeMinutes: DEFAULT_MIN_CART_AGE_MINUTES,
			lastError: null,
		},
		update: {
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: normalizeFilters(filters),
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minCartAgeMinutes: DEFAULT_MIN_CART_AGE_MINUTES,
			lastError: null,
		},
	});

	return serializeSetting(setting);
}

async function findAutomationCandidates(setting) {
	const filters = normalizeFilters(setting.filters || {});
	const since = subtractDays(filters.daysBack);
	const olderThan = subtractMinutes(setting.minCartAgeMinutes || DEFAULT_MIN_CART_AGE_MINUTES);

	const rawCarts = await prisma.abandonedCart.findMany({
		where: {
			workspaceId: setting.workspaceId,
			status: 'NEW',
			contactPhone: { not: null },
			abandonedCheckoutUrl: { not: null },
			checkoutCreatedAt: {
				gte: since,
				lte: olderThan,
			},
			...(typeof filters.minTotal === 'number' && Number.isFinite(filters.minTotal)
				? { totalAmount: { gte: filters.minTotal } }
				: {}),
		},
		orderBy: [{ checkoutCreatedAt: 'asc' }, { updatedAt: 'asc' }],
		take: Math.min(filters.limit * 4, 1000),
	});

	const recoverableCarts = await filterRecoverableAbandonedCarts(rawCarts, setting.workspaceId);
	const checkoutIds = recoverableCarts.map((cart) => normalizeString(cart.checkoutId)).filter(Boolean);
	let existingLogs = [];
	if (checkoutIds.length) {
		try {
			existingLogs = await prisma.abandonedCartAutomationLog.findMany({
				where: {
					workspaceId: setting.workspaceId,
					checkoutId: { in: checkoutIds },
				},
				select: { checkoutId: true },
			});
		} catch (error) {
			if (!isAbandonedCartAutomationTableMissing(error)) throw error;
			await ensureAbandonedCartAutomationTables(setting.workspaceId);
			existingLogs = await prisma.abandonedCartAutomationLog.findMany({
				where: {
					workspaceId: setting.workspaceId,
					checkoutId: { in: checkoutIds },
				},
				select: { checkoutId: true },
			});
		}
	}
	const loggedCheckoutIds = new Set(existingLogs.map((log) => log.checkoutId));
	const latestByPhone = new Map();

	for (const cart of recoverableCarts) {
		const checkoutId = normalizeString(cart.checkoutId);
		const phone = normalizeWhatsAppIdentityPhone(cart.contactPhone || '');
		if (!checkoutId || !phone || loggedCheckoutIds.has(checkoutId)) continue;
		if (!cartMatchesProductQuery(cart, filters.productQuery)) continue;

		const previous = latestByPhone.get(phone);
		const cartTs = new Date(cart.checkoutCreatedAt || cart.updatedAt || cart.createdAt || 0).getTime();
		const previousTs = previous
			? new Date(previous.checkoutCreatedAt || previous.updatedAt || previous.createdAt || 0).getTime()
			: -1;

		if (!previous || cartTs > previousTs) {
			latestByPhone.set(phone, cart);
		}
	}

	return [...latestByPhone.values()].slice(0, filters.limit);
}

async function claimCandidateLogs(setting, candidates = []) {
	const rows = candidates.map((cart) => ({
		workspaceId: setting.workspaceId,
		checkoutId: normalizeString(cart.checkoutId),
		recipientPhone: normalizeWhatsAppIdentityPhone(cart.contactPhone || '') || null,
		templateName: setting.templateName || null,
		rawPayload: {
			cartId: cart.id,
			checkoutId: cart.checkoutId,
			contactName: cart.contactName || null,
			phone: maskPhone(cart.contactPhone || ''),
			productName: getPrimaryProductName(cart) || null,
		},
	})).filter((row) => row.checkoutId);

	if (!rows.length) return [];

	try {
		await prisma.abandonedCartAutomationLog.createMany({
			data: rows,
			skipDuplicates: true,
		});
	} catch (error) {
		if (!isAbandonedCartAutomationTableMissing(error)) throw error;
		await ensureAbandonedCartAutomationTables(setting.workspaceId);
		await prisma.abandonedCartAutomationLog.createMany({
			data: rows,
			skipDuplicates: true,
		});
	}

	const claimed = await prisma.abandonedCartAutomationLog.findMany({
		where: {
			workspaceId: setting.workspaceId,
			checkoutId: { in: rows.map((row) => row.checkoutId) },
			campaignId: null,
		},
		select: { checkoutId: true },
	});
	const claimedIds = new Set(claimed.map((row) => row.checkoutId));
	return candidates.filter((cart) => claimedIds.has(normalizeString(cart.checkoutId)));
}

async function createAndLaunchAutomationCampaign(setting, carts = [], { launchedByUserId = null } = {}) {
	const filters = normalizeFilters(setting.filters || {});
	const checkoutIds = carts.map((cart) => normalizeString(cart.checkoutId)).filter(Boolean);
	const created = await createCampaignDraft({
		workspaceId: setting.workspaceId,
		name: `Automatizacion carritos ${new Date().toISOString().slice(0, 10)}`,
		templateId: setting.templateLocalId,
		languageCode: setting.templateLanguage || 'es_AR',
		audienceSource: 'abandoned_carts',
		audienceFilters: {
			...filters,
			status: 'NEW',
			checkoutIds,
			limit: checkoutIds.length,
		},
		notes: 'Automatizacion horaria de carritos abandonados.',
		launchedByUserId,
	});
	const campaignId = created?.campaign?.id || null;

	if (campaignId) {
		await prisma.abandonedCartAutomationLog.updateMany({
			where: {
				workspaceId: setting.workspaceId,
				checkoutId: { in: checkoutIds },
				campaignId: null,
			},
			data: { campaignId },
		});
		await launchCampaign(campaignId, { workspaceId: setting.workspaceId });
	}

	return {
		campaignId,
		selectedCount: Number(created?.campaign?.pendingRecipients || created?.campaign?.totalRecipients || 0),
	};
}

export async function runAbandonedCartAutomation({
	workspaceId = DEFAULT_WORKSPACE_ID,
	force = false,
	launchedByUserId = null,
} = {}) {
	const setting = await ensureSetting(workspaceId);

	if (!setting.enabled || !setting.templateLocalId) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'disabled' };
	}

	const intervalMs = DEFAULT_INTERVAL_MINUTES * 60 * 1000;
	if (!force && setting.lastRunAt && Date.now() - new Date(setting.lastRunAt).getTime() < intervalMs) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'interval' };
	}

	try {
		await syncAbandonedCarts(30, { workspaceId: setting.workspaceId });
		const candidates = await findAutomationCandidates(setting);
		const claimedCandidates = await claimCandidateLogs(setting, candidates);

		if (!claimedCandidates.length) {
			await prisma.abandonedCartAutomationSetting.update({
				where: { workspaceId: setting.workspaceId },
				data: {
					lastRunAt: new Date(),
					lastError: null,
				},
			});
			return { workspaceId: setting.workspaceId, processed: 0, campaignId: null };
		}

		const result = await createAndLaunchAutomationCampaign(setting, claimedCandidates, { launchedByUserId });
		await prisma.abandonedCartAutomationSetting.update({
			where: { workspaceId: setting.workspaceId },
			data: {
				lastRunAt: new Date(),
				lastCampaignId: result.campaignId || null,
				lastError: null,
				runCount: { increment: 1 },
			},
		});

		logger.info('abandoned_cart_automation.processed', {
			workspaceId: setting.workspaceId,
			campaignId: result.campaignId,
			selectedCount: result.selectedCount,
		});

		return {
			workspaceId: setting.workspaceId,
			processed: result.selectedCount,
			campaignId: result.campaignId,
		};
	} catch (error) {
		await prisma.abandonedCartAutomationSetting.update({
			where: { workspaceId: setting.workspaceId },
			data: {
				lastRunAt: new Date(),
				lastError: error.message || 'Error ejecutando automatizacion de carritos.',
			},
		});
		logger.error('abandoned_cart_automation.failed', {
			workspaceId: setting.workspaceId,
			error,
		});
		return { workspaceId: setting.workspaceId, processed: 0, error: error.message };
	}
}

export async function processAutomaticAbandonedCartAutomations() {
	let settings = [];

	try {
		settings = await prisma.abandonedCartAutomationSetting.findMany({
			where: { enabled: true },
		});
	} catch (error) {
		if (!isAbandonedCartAutomationTableMissing(error)) throw error;
		await ensureAbandonedCartAutomationTables();
		settings = await prisma.abandonedCartAutomationSetting.findMany({
			where: { enabled: true },
		});
	}
	const results = [];

	for (const setting of settings) {
		results.push(await runAbandonedCartAutomation({ workspaceId: setting.workspaceId }));
	}

	return {
		processed: results.reduce((sum, item) => sum + Number(item.processed || 0), 0),
		results,
	};
}
