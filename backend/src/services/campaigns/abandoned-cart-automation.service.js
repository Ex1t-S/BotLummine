import { prisma } from '../../lib/prisma.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { syncAbandonedCarts } from '../carts/abandoned-cart.service.js';
import { normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import {
	WORKSPACE_FEATURE_FLAGS,
	isWorkspaceFeatureEnabled,
} from '../workspaces/workspace-feature-flags.service.js';
import { getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import { requireWorkspaceScope } from '../workspaces/workspace-scope.js';
import { filterRecoverableAbandonedCarts } from './campaign-attribution.service.js';
import { getOrCreateDailyAutomationRun, markAutomationRunError, touchAutomationRun, AUTOMATION_RUN_TYPES } from './automation-run.service.js';
import { createOrAppendAutomationCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';
import { createAutomationSchemaNotReadyError } from './automation-schema-error.js';

const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_MIN_CART_AGE_MINUTES = 60;
const DEFAULT_ACTIVE_INTERVAL_MINUTES = 60;
const DEFAULT_IDLE_INTERVAL_MINUTES = 60;
const DEFAULT_DEEP_IDLE_INTERVAL_MINUTES = 60;
const DEFAULT_FILTERS = {
	daysBack: 30,
	status: 'NEW',
	limit: 50,
	minTotal: null,
	productQuery: '',
};
const runtimeStateByWorkspace = new Map();

function isAbandonedCartAutomationTableMissing(error) {
	return (
		['P2021', 'P2022'].includes(error?.code) ||
		/AbandonedCartAutomationSetting|AbandonedCartAutomationLog|public\.AbandonedCartAutomation/i.test(
			String(error?.message || '')
		)
	);
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

function normalizeIntervalMinutes(value, fallback, min = 5, max = 24 * 60) {
	const parsed = Number(value || fallback);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(parsed, max));
}

function getRuntimeState(workspaceId) {
	const key = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const current = runtimeStateByWorkspace.get(key) || {
		lastCheckedAt: null,
		emptyRuns: 0,
		lastProcessed: 0,
	};
	runtimeStateByWorkspace.set(key, current);
	return current;
}

function resolveNextIntervalMs(setting = {}, runtimeState = {}) {
	const activeMinutes = normalizeIntervalMinutes(
		process.env.ABANDONED_CART_ACTIVE_INTERVAL_MINUTES || setting.intervalMinutes,
		DEFAULT_ACTIVE_INTERVAL_MINUTES,
		60,
		24 * 60
	);
	const idleMinutes = normalizeIntervalMinutes(
		process.env.ABANDONED_CART_IDLE_INTERVAL_MINUTES,
		DEFAULT_IDLE_INTERVAL_MINUTES,
		60,
		24 * 60
	);
	const deepIdleMinutes = normalizeIntervalMinutes(
		process.env.ABANDONED_CART_DEEP_IDLE_INTERVAL_MINUTES,
		DEFAULT_DEEP_IDLE_INTERVAL_MINUTES,
		60,
		24 * 60
	);

	if (Number(runtimeState.lastProcessed || 0) > 0 || Number(runtimeState.emptyRuns || 0) === 0) {
		return activeMinutes * 60 * 1000;
	}

	return (Number(runtimeState.emptyRuns || 0) >= 3 ? deepIdleMinutes : idleMinutes) * 60 * 1000;
}

function shouldSkipRuntimeInterval(setting = {}) {
	const runtimeState = getRuntimeState(setting.workspaceId);
	if (!runtimeState.lastCheckedAt) return { skip: false, runtimeState };

	const intervalMs = resolveNextIntervalMs(setting, runtimeState);
	const elapsedMs = Date.now() - new Date(runtimeState.lastCheckedAt).getTime();
	if (elapsedMs >= intervalMs) return { skip: false, runtimeState };

	return {
		skip: true,
		runtimeState,
		nextRunInMs: intervalMs - elapsedMs,
	};
}

function recordRuntimeResult(workspaceId, processed = 0) {
	const key = requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
	const runtimeState = getRuntimeState(key);
	const count = Number(processed || 0);
	runtimeState.lastCheckedAt = new Date();
	runtimeState.lastProcessed = count;
	runtimeState.emptyRuns = count > 0 ? 0 : Number(runtimeState.emptyRuns || 0) + 1;
	runtimeStateByWorkspace.set(key, runtimeState);
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
		variableMapping: normalizeMapping(input.variableMapping || {}),
		manualVariables: normalizeManualVariables(input.manualVariables || {}),
	};
}

function normalizeMapping(input = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

	return Object.fromEntries(
		Object.entries(input)
			.map(([key, value]) => {
				const normalizedKey = normalizeString(key);
				if (!normalizedKey) return null;

				if (value && typeof value === 'object' && !Array.isArray(value)) {
					const source = normalizeString(value.source);
					if (!source) return null;

					return [
						normalizedKey,
						{
							source,
							fixedValue: String(value.fixedValue ?? ''),
						},
					];
				}

				const source = normalizeString(value);
				return source ? [normalizedKey, source] : null;
			})
			.filter(Boolean)
	);
}

function normalizeManualVariables(input = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

	return Object.fromEntries(
		Object.entries(input)
			.map(([key, value]) => [normalizeString(key), String(value ?? '').trim()])
			.filter(([key]) => key)
	);
}

function serializeSetting(setting = null) {
	const filters = normalizeFilters(setting?.filters || DEFAULT_FILTERS);
	return {
		enabled: Boolean(setting?.enabled),
		templateId: setting?.templateLocalId || '',
		templateName: setting?.templateName || '',
		templateLanguage: setting?.templateLanguage || 'es_AR',
		filters,
		variableMapping: filters.variableMapping || {},
		manualVariables: filters.manualVariables || {},
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

function resolveAbandonedCartAutomationWorkspaceId(workspaceId) {
	return requireWorkspaceScope(normalizeWorkspaceId(workspaceId));
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

async function ensureSetting(workspaceId) {
	const resolvedWorkspaceId = resolveAbandonedCartAutomationWorkspaceId(workspaceId);
	let existing = null;

	try {
		existing = await prisma.abandonedCartAutomationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	} catch (error) {
		if (!isAbandonedCartAutomationTableMissing(error)) throw error;
		throw createAutomationSchemaNotReadyError('de carritos abandonados', error);
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

export async function getAbandonedCartAutomationSettings({ workspaceId } = {}) {
	return serializeSetting(await ensureSetting(workspaceId));
}

export async function updateAbandonedCartAutomationSettings({
	workspaceId,
	enabled = false,
	templateId = null,
	filters = {},
	variableMapping = undefined,
	manualVariables = undefined,
} = {}) {
	const resolvedWorkspaceId = resolveAbandonedCartAutomationWorkspaceId(workspaceId);
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

	const currentFilters = normalizeFilters(current?.filters || DEFAULT_FILTERS);
	const nextFilters = normalizeFilters({
		...filters,
		variableMapping:
			variableMapping === undefined
				? filters.variableMapping || currentFilters.variableMapping
				: variableMapping,
		manualVariables:
			manualVariables === undefined
				? filters.manualVariables || currentFilters.manualVariables
				: manualVariables,
	});

	const setting = await prisma.abandonedCartAutomationSetting.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		create: {
			workspaceId: resolvedWorkspaceId,
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: nextFilters,
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minCartAgeMinutes: DEFAULT_MIN_CART_AGE_MINUTES,
			lastError: null,
		},
		update: {
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: nextFilters,
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
					campaignId: { not: null },
				},
				select: { checkoutId: true },
			});
		} catch (error) {
			if (!isAbandonedCartAutomationTableMissing(error)) throw error;
			throw createAutomationSchemaNotReadyError('de carritos abandonados', error);
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
		throw createAutomationSchemaNotReadyError('de carritos abandonados', error);
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
	const run = await getOrCreateDailyAutomationRun({
		workspaceId: setting.workspaceId,
		type: AUTOMATION_RUN_TYPES.ABANDONED_CART,
	});

	try {
		const created = await createOrAppendAutomationCampaignDraft({
			workspaceId: setting.workspaceId,
			automationRunId: run.id,
			name: `Automatizacion carritos ${run.runKey}`,
			templateId: setting.templateLocalId,
			languageCode: setting.templateLanguage || 'es_AR',
			audienceSource: 'abandoned_carts',
			audienceFilters: {
				...filters,
				status: 'NEW',
				checkoutIds,
				limit: checkoutIds.length,
				variableMapping: filters.variableMapping || {},
				manualVariables: filters.manualVariables || {},
			},
			notes: 'Automatizacion horaria de carritos abandonados.',
			launchedByUserId,
		});
		const campaignId = created?.campaign?.id || created?.campaignId || null;

		if (campaignId) {
			await prisma.abandonedCartAutomationLog.updateMany({
				where: {
					workspaceId: setting.workspaceId,
					checkoutId: { in: checkoutIds },
					campaignId: null,
				},
				data: { campaignId, automationRunId: run.id },
			});
			if (Number(created?.pendingRecipients || created?.campaign?.pendingRecipients || 0) > 0) {
				await launchCampaign(campaignId, { workspaceId: setting.workspaceId });
			}
		}

		await touchAutomationRun(run.id, { workspaceId: setting.workspaceId, status: 'OPEN' });

		return {
			automationRunId: run.id,
			campaignId,
			selectedCount: Number(created?.addedRecipients || created?.campaign?.pendingRecipients || created?.campaign?.totalRecipients || 0),
		};
	} catch (error) {
		await prisma.abandonedCartAutomationLog.deleteMany({
			where: {
				workspaceId: setting.workspaceId,
				checkoutId: { in: checkoutIds },
				campaignId: null,
			},
		});
		await markAutomationRunError(run.id, error, { workspaceId: setting.workspaceId });
		throw error;
	}
}

export async function runAbandonedCartAutomation({
	workspaceId,
	force = false,
	launchedByUserId = null,
} = {}) {
	const setting = await ensureSetting(workspaceId);

	if (!(await isWorkspaceFeatureEnabled(setting.workspaceId, WORKSPACE_FEATURE_FLAGS.AUTOMATION_DISPATCH))) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'automation_dispatch_paused' };
	}

	if (!setting.enabled || !setting.templateLocalId) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'disabled' };
	}

	const intervalMs = normalizeIntervalMinutes(
		process.env.ABANDONED_CART_ACTIVE_INTERVAL_MINUTES || setting.intervalMinutes || DEFAULT_ACTIVE_INTERVAL_MINUTES,
		DEFAULT_ACTIVE_INTERVAL_MINUTES,
		60,
		24 * 60
	) * 60 * 1000;
	if (!force && setting.lastRunAt && Date.now() - new Date(setting.lastRunAt).getTime() < intervalMs) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'interval' };
	}

	try {
		await syncAbandonedCarts(30, { workspaceId: setting.workspaceId });
		const candidates = await findAutomationCandidates(setting);
		const claimedCandidates = await claimCandidateLogs(setting, candidates);

		if (!claimedCandidates.length) {
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
		throw createAutomationSchemaNotReadyError('de carritos abandonados', error);
	}
	const results = [];

	for (const setting of settings) {
		const intervalDecision = shouldSkipRuntimeInterval(setting);
		if (intervalDecision.skip) {
			results.push({
				workspaceId: setting.workspaceId,
				processed: 0,
				skipped: true,
				reason: 'adaptive_interval',
				emptyRuns: intervalDecision.runtimeState.emptyRuns,
				nextRunInMs: intervalDecision.nextRunInMs,
			});
			continue;
		}

		const result = await runAbandonedCartAutomation({ workspaceId: setting.workspaceId });
		recordRuntimeResult(setting.workspaceId, result.processed || 0);
		results.push(result);
	}

	return {
		processed: results.reduce((sum, item) => sum + Number(item.processed || 0), 0),
		results,
	};
}
