import { prisma } from '../../lib/prisma.js';
import { logger, maskPhone } from '../../lib/logger.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import {
	WORKSPACE_FEATURE_FLAGS,
	isWorkspaceFeatureEnabled,
} from '../workspaces/workspace-feature-flags.service.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import { createCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';

const DEFAULT_INTERVAL_MINUTES = 60;
const DEFAULT_MIN_ORDER_AGE_MINUTES = 120;
const PENDING_PAYMENT_STATUSES = ['pending', 'pending_confirmation', 'unpaid', 'pago pendiente', 'pago en espera'];
const DEFAULT_FILTERS = {
	daysBack: 5,
	limit: 50,
	minTotal: null,
	productQuery: '',
};
const PENDING_PAYMENT_VARIABLE_OPTIONS = [
	{ key: 'first_name', label: 'Nombre', description: 'Primer nombre del destinatario' },
	{ key: 'contact_name', label: 'Nombre completo', description: 'Nombre completo del destinatario' },
	{ key: 'phone', label: 'Telefono', description: 'Telefono normalizado' },
	{ key: 'order_number', label: 'Numero de orden', description: 'Numero visible del pedido' },
	{ key: 'order_id', label: 'ID de orden', description: 'Identificador interno del pedido' },
	{ key: 'payment_status', label: 'Estado de pago', description: 'Estado de pago detectado' },
	{ key: 'payment_link', label: 'Link de pago', description: 'Link de pago disponible en el pedido' },
	{ key: 'gateway_name', label: 'Gateway', description: 'Pasarela o metodo de pago' },
	{ key: 'product_name', label: 'Producto', description: 'Primer producto del pedido' },
	{ key: 'total_amount', label: 'Monto total', description: 'Total formateado del pedido' },
	{ key: 'total_raw', label: 'Monto sin formato', description: 'Total numerico del pedido' },
];

function isPendingPaymentAutomationTableMissing(error) {
	return (
		['P2021', 'P2022'].includes(error?.code) ||
		/PendingPaymentAutomationSetting|PendingPaymentAutomationLog|public\.PendingPaymentAutomation/i.test(
			String(error?.message || '')
		)
	);
}

async function ensurePendingPaymentAutomationTables(workspaceId = DEFAULT_WORKSPACE_ID) {
	try {
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "PendingPaymentAutomationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "filters" JSONB,
    "variableMapping" JSONB,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "minOrderAgeMinutes" INTEGER NOT NULL DEFAULT 120,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PendingPaymentAutomationSetting_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "PendingPaymentAutomationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "orderKey" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "templateName" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PendingPaymentAutomationLog_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "PendingPaymentAutomationSetting_workspaceId_key"
ON "PendingPaymentAutomationSetting"("workspaceId")`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_orderKey_key"
ON "PendingPaymentAutomationLog"("workspaceId", "orderKey")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_createdAt_idx"
ON "PendingPaymentAutomationLog"("workspaceId", "createdAt")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "PendingPaymentAutomationLog_workspaceId_campaignId_idx"
ON "PendingPaymentAutomationLog"("workspaceId", "campaignId")`);
		await prisma.$executeRawUnsafe(`
ALTER TABLE "PendingPaymentAutomationSetting" ADD COLUMN IF NOT EXISTS "variableMapping" JSONB`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'PendingPaymentAutomationSetting_workspaceId_fkey'
	) THEN
		ALTER TABLE "PendingPaymentAutomationSetting"
		ADD CONSTRAINT "PendingPaymentAutomationSetting_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'PendingPaymentAutomationLog_workspaceId_fkey'
	) THEN
		ALTER TABLE "PendingPaymentAutomationLog"
		ADD CONSTRAINT "PendingPaymentAutomationLog_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		logger.warn('pending_payment_automation.tables_repaired', { workspaceId });
	} catch (repairError) {
		logger.error('pending_payment_automation.table_repair_failed', { workspaceId, error: repairError });
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
	return {
		daysBack: DEFAULT_FILTERS.daysBack,
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

function normalizeMapping(input = {}) {
	if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
	return Object.fromEntries(
		Object.entries(input)
			.map(([key, value]) => [normalizeString(key), normalizeString(value)])
			.filter(([key, value]) => key && value)
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
		variableMapping: normalizeMapping(setting?.variableMapping || {}),
		availableVariables: PENDING_PAYMENT_VARIABLE_OPTIONS,
		intervalMinutes: Number(setting?.intervalMinutes || DEFAULT_INTERVAL_MINUTES),
		minOrderAgeMinutes: Number(setting?.minOrderAgeMinutes || DEFAULT_MIN_ORDER_AGE_MINUTES),
		lastRunAt: setting?.lastRunAt || null,
		lastCampaignId: setting?.lastCampaignId || null,
		lastError: setting?.lastError || null,
		runCount: Number(setting?.runCount || 0),
	};
}

function subtractMinutes(minutes) {
	return new Date(Date.now() - Math.max(1, Number(minutes) || DEFAULT_MIN_ORDER_AGE_MINUTES) * 60 * 1000);
}

function subtractDays(days) {
	return new Date(Date.now() - Math.max(1, Number(days) || DEFAULT_FILTERS.daysBack) * 24 * 60 * 60 * 1000);
}

function getOrderKey(order = {}) {
	return normalizeString(order.orderId || order.orderNumber || order.id || '');
}

function getPrimaryProductName(order = {}) {
	const products = Array.isArray(order.products) ? order.products : [];
	const product = products[0] || {};
	return normalizeString(product?.name || product?.title || product?.productName || product?.sku || '');
}

function orderMatchesProductQuery(order = {}, productQuery = '') {
	const needle = normalizeString(productQuery).toLowerCase();
	if (!needle) return true;
	const products = Array.isArray(order.products) ? order.products : [];
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
		existing = await prisma.pendingPaymentAutomationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	} catch (error) {
		if (!isPendingPaymentAutomationTableMissing(error)) throw error;
		await ensurePendingPaymentAutomationTables(resolvedWorkspaceId);
		existing = await prisma.pendingPaymentAutomationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	}

	if (existing) return existing;

	return prisma.pendingPaymentAutomationSetting.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			enabled: false,
			filters: DEFAULT_FILTERS,
			variableMapping: {},
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minOrderAgeMinutes: DEFAULT_MIN_ORDER_AGE_MINUTES,
		},
	});
}

export async function getPendingPaymentAutomationSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	return serializeSetting(await ensureSetting(workspaceId));
}

export async function updatePendingPaymentAutomationSettings({
	workspaceId = DEFAULT_WORKSPACE_ID,
	enabled = false,
	templateId = null,
	filters = {},
	variableMapping = undefined,
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
		throw new Error('Elegi una plantilla antes de activar la automatizacion de pagos pendientes.');
	}
	const nextVariableMapping =
		variableMapping === undefined ? normalizeMapping(current?.variableMapping || {}) : normalizeMapping(variableMapping);

	const setting = await prisma.pendingPaymentAutomationSetting.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		create: {
			workspaceId: resolvedWorkspaceId,
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: normalizeFilters(filters),
			variableMapping: nextVariableMapping,
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minOrderAgeMinutes: DEFAULT_MIN_ORDER_AGE_MINUTES,
			lastError: null,
		},
		update: {
			enabled: nextEnabled,
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			filters: normalizeFilters(filters),
			variableMapping: nextVariableMapping,
			intervalMinutes: DEFAULT_INTERVAL_MINUTES,
			minOrderAgeMinutes: DEFAULT_MIN_ORDER_AGE_MINUTES,
			lastError: null,
		},
	});

	return serializeSetting(setting);
}

async function findAutomationCandidates(setting) {
	const filters = normalizeFilters(setting.filters || {});
	const since = subtractDays(filters.daysBack);
	const olderThan = subtractMinutes(setting.minOrderAgeMinutes || DEFAULT_MIN_ORDER_AGE_MINUTES);

	const rawOrders = await prisma.customerOrder.findMany({
		where: {
			workspaceId: setting.workspaceId,
			normalizedPhone: { not: null },
			orderCreatedAt: { gte: since, lte: olderThan },
			OR: PENDING_PAYMENT_STATUSES.map((paymentStatus) => ({
				paymentStatus: { equals: paymentStatus, mode: 'insensitive' },
			})),
			...(typeof filters.minTotal === 'number' && Number.isFinite(filters.minTotal)
				? { totalAmount: { gte: filters.minTotal } }
				: {}),
		},
		include: { items: true },
		orderBy: [{ orderCreatedAt: 'asc' }, { orderUpdatedAt: 'asc' }, { createdAt: 'asc' }],
		take: Math.min(filters.limit * 4, 1000),
	});

	const orderKeys = rawOrders.map(getOrderKey).filter(Boolean);
	let existingLogs = [];
	if (orderKeys.length) {
		try {
			existingLogs = await prisma.pendingPaymentAutomationLog.findMany({
				where: { workspaceId: setting.workspaceId, orderKey: { in: orderKeys }, campaignId: { not: null } },
				select: { orderKey: true },
			});
		} catch (error) {
			if (!isPendingPaymentAutomationTableMissing(error)) throw error;
			await ensurePendingPaymentAutomationTables(setting.workspaceId);
			existingLogs = await prisma.pendingPaymentAutomationLog.findMany({
				where: { workspaceId: setting.workspaceId, orderKey: { in: orderKeys }, campaignId: { not: null } },
				select: { orderKey: true },
			});
		}
	}
	const loggedOrderKeys = new Set(existingLogs.map((log) => log.orderKey));
	const latestByPhone = new Map();

	for (const order of rawOrders) {
		const orderKey = getOrderKey(order);
		const phone = normalizeWhatsAppIdentityPhone(order.normalizedPhone || order.contactPhone || '');
		if (!orderKey || !phone || loggedOrderKeys.has(orderKey)) continue;
		if (!orderMatchesProductQuery(order, filters.productQuery)) continue;

		const previous = latestByPhone.get(phone);
		const orderTs = new Date(order.orderCreatedAt || order.orderUpdatedAt || order.createdAt || 0).getTime();
		const previousTs = previous
			? new Date(previous.orderCreatedAt || previous.orderUpdatedAt || previous.createdAt || 0).getTime()
			: -1;

		if (!previous || orderTs > previousTs) {
			latestByPhone.set(phone, order);
		}
	}

	return [...latestByPhone.values()].slice(0, filters.limit);
}

async function claimCandidateLogs(setting, candidates = []) {
	const rows = candidates.map((order) => ({
		workspaceId: setting.workspaceId,
		orderKey: getOrderKey(order),
		recipientPhone: normalizeWhatsAppIdentityPhone(order.normalizedPhone || order.contactPhone || '') || null,
		templateName: setting.templateName || null,
		rawPayload: {
			orderId: order.orderId || null,
			orderNumber: order.orderNumber || null,
			contactName: order.contactName || null,
			phone: maskPhone(order.normalizedPhone || order.contactPhone || ''),
			productName: getPrimaryProductName(order) || null,
			paymentStatus: order.paymentStatus || null,
		},
	})).filter((row) => row.orderKey);

	if (!rows.length) return [];

	try {
		await prisma.pendingPaymentAutomationLog.createMany({ data: rows, skipDuplicates: true });
	} catch (error) {
		if (!isPendingPaymentAutomationTableMissing(error)) throw error;
		await ensurePendingPaymentAutomationTables(setting.workspaceId);
		await prisma.pendingPaymentAutomationLog.createMany({ data: rows, skipDuplicates: true });
	}

	const claimed = await prisma.pendingPaymentAutomationLog.findMany({
		where: {
			workspaceId: setting.workspaceId,
			orderKey: { in: rows.map((row) => row.orderKey) },
			campaignId: null,
		},
		select: { orderKey: true },
	});
	const claimedKeys = new Set(claimed.map((row) => row.orderKey));
	return candidates.filter((order) => claimedKeys.has(getOrderKey(order)));
}

async function createAndLaunchAutomationCampaign(setting, orders = [], { launchedByUserId = null } = {}) {
	const filters = normalizeFilters(setting.filters || {});
	const orderKeys = orders.map(getOrderKey).filter(Boolean);
	const created = await createCampaignDraft({
		workspaceId: setting.workspaceId,
		name: `Automatizacion pagos pendientes ${new Date().toISOString().slice(0, 10)}`,
		templateId: setting.templateLocalId,
		languageCode: setting.templateLanguage || 'es_AR',
		audienceSource: 'pending_payment',
		audienceFilters: {
			...filters,
			variableMapping: normalizeMapping(setting.variableMapping || {}),
			orderKeys,
			limit: orderKeys.length,
		},
		notes: 'Automatizacion de pagos pendientes por edad de pedido.',
		launchedByUserId,
	});
	const campaignId = created?.campaign?.id || null;

	if (campaignId) {
		await prisma.pendingPaymentAutomationLog.updateMany({
			where: {
				workspaceId: setting.workspaceId,
				orderKey: { in: orderKeys },
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

export async function runPendingPaymentAutomation({
	workspaceId = DEFAULT_WORKSPACE_ID,
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

	const intervalMs = Math.max(1, Number(setting.intervalMinutes || DEFAULT_INTERVAL_MINUTES)) * 60 * 1000;
	if (!force && setting.lastRunAt && Date.now() - new Date(setting.lastRunAt).getTime() < intervalMs) {
		return { workspaceId: setting.workspaceId, processed: 0, skipped: true, reason: 'interval' };
	}

	try {
		const candidates = await findAutomationCandidates(setting);
		const claimedCandidates = await claimCandidateLogs(setting, candidates);

		if (!claimedCandidates.length) {
			return { workspaceId: setting.workspaceId, processed: 0, campaignId: null };
		}

		const result = await createAndLaunchAutomationCampaign(setting, claimedCandidates, { launchedByUserId });
		await prisma.pendingPaymentAutomationSetting.update({
			where: { workspaceId: setting.workspaceId },
			data: {
				lastRunAt: new Date(),
				lastCampaignId: result.campaignId || null,
				lastError: null,
				runCount: { increment: 1 },
			},
		});

		logger.info('pending_payment_automation.processed', {
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
		await prisma.pendingPaymentAutomationSetting.update({
			where: { workspaceId: setting.workspaceId },
			data: {
				lastRunAt: new Date(),
				lastError: error.message || 'Error ejecutando automatizacion de pagos pendientes.',
			},
		});
		logger.error('pending_payment_automation.failed', { workspaceId: setting.workspaceId, error });
		return { workspaceId: setting.workspaceId, processed: 0, error: error.message };
	}
}

export async function processAutomaticPendingPaymentAutomations() {
	let settings = [];
	try {
		settings = await prisma.pendingPaymentAutomationSetting.findMany({ where: { enabled: true } });
	} catch (error) {
		if (!isPendingPaymentAutomationTableMissing(error)) throw error;
		await ensurePendingPaymentAutomationTables();
		settings = await prisma.pendingPaymentAutomationSetting.findMany({ where: { enabled: true } });
	}
	const results = [];

	for (const setting of settings) {
		results.push(await runPendingPaymentAutomation({ workspaceId: setting.workspaceId }));
	}

	return {
		processed: results.reduce((sum, item) => sum + Number(item.processed || 0), 0),
		results,
	};
}
