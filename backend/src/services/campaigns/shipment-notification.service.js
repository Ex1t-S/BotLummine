import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import {
	extractOrderShippingSignals,
	getShippingStatusMeta,
	getShippingStatusSearchTerms,
	isDispatchedShippingStatus,
} from '../common/shipping-status.js';
import { createCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';

const DEFAULT_DAYS_BACK = 14;
const AUTO_LIMIT = 100;
const DEFAULT_VARIABLE_MAPPING = {
	'1': 'first_name',
	'2': 'order_number',
	'3': 'tracking_url',
	'4': 'tracking_number',
	'5': 'product_name',
	contact_name: 'contact_name',
	first_name: 'first_name',
	phone: 'phone',
	wa_id: 'wa_id',
	order_number: 'order_number',
	order_id: 'order_id',
	shipment_id: 'shipment_id',
	tracking_number: 'tracking_number',
	tracking_url: 'tracking_url',
	shipping_status: 'shipping_status',
	shipping_method: 'shipping_method',
	product_name: 'product_name',
	first_product_name: 'product_name',
};

const SHIPMENT_VARIABLE_OPTIONS = [
	{ key: 'first_name', label: 'Nombre', description: 'Primer nombre del destinatario' },
	{ key: 'contact_name', label: 'Nombre completo', description: 'Nombre completo del destinatario' },
	{ key: 'phone', label: 'Telefono', description: 'Telefono normalizado del destinatario' },
	{ key: 'order_number', label: 'Numero de orden', description: 'Numero visible del pedido' },
	{ key: 'order_id', label: 'ID de orden', description: 'Identificador interno del pedido' },
	{ key: 'shipment_id', label: 'ID de despacho', description: 'Identificador del envio en Enbox' },
	{ key: 'tracking_number', label: 'Numero de seguimiento', description: 'Codigo de tracking' },
	{ key: 'tracking_url', label: 'Link de seguimiento', description: 'URL para seguir el envio' },
	{ key: 'shipping_status', label: 'Estado de envio', description: 'Estado del despacho' },
	{ key: 'shipping_method', label: 'Metodo de envio', description: 'Metodo o transportista' },
	{ key: 'product_name', label: 'Producto', description: 'Primer producto del pedido' },
	{ key: 'source', label: 'Origen', description: 'Enbox o TiendaNube' },
	{ key: 'updated_at', label: 'Fecha de actualizacion', description: 'Fecha detectada del despacho' },
];

function isShipmentNotificationLogMissing(error) {
	return (
		['P2021', 'P2022'].includes(error?.code) ||
		/ShipmentNotificationSetting|ShipmentNotificationLog|public\.ShipmentNotification/i.test(String(error?.message || ''))
	);
}

async function ensureShipmentNotificationLogTable(workspaceId = DEFAULT_WORKSPACE_ID) {
	try {
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "ShipmentNotificationSetting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "templateLocalId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT NOT NULL DEFAULT 'es_AR',
    "variableMapping" JSONB,
    "daysBack" INTEGER NOT NULL DEFAULT 3,
    "lastRunAt" TIMESTAMP(3),
    "lastCampaignId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShipmentNotificationSetting_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
CREATE TABLE IF NOT EXISTS "ShipmentNotificationLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notificationKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "shipmentId" TEXT,
    "campaignId" TEXT,
    "recipientPhone" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentNotificationLog_pkey" PRIMARY KEY ("id")
)`);
		await prisma.$executeRawUnsafe(`
ALTER TABLE "ShipmentNotificationSetting" ADD COLUMN IF NOT EXISTS "variableMapping" JSONB`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentNotificationSetting_workspaceId_key"
ON "ShipmentNotificationSetting"("workspaceId")`);
		await prisma.$executeRawUnsafe(`
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_notificationKey_key"
ON "ShipmentNotificationLog"("workspaceId", "notificationKey")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_sentAt_idx"
ON "ShipmentNotificationLog"("workspaceId", "sentAt")`);
		await prisma.$executeRawUnsafe(`
CREATE INDEX IF NOT EXISTS "ShipmentNotificationLog_workspaceId_campaignId_idx"
ON "ShipmentNotificationLog"("workspaceId", "campaignId")`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentNotificationSetting_workspaceId_fkey'
	) THEN
		ALTER TABLE "ShipmentNotificationSetting"
		ADD CONSTRAINT "ShipmentNotificationSetting_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		await prisma.$executeRawUnsafe(`
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'ShipmentNotificationLog_workspaceId_fkey'
	) THEN
		ALTER TABLE "ShipmentNotificationLog"
		ADD CONSTRAINT "ShipmentNotificationLog_workspaceId_fkey"
		FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
		ON DELETE CASCADE ON UPDATE CASCADE;
	END IF;
END $$;`);
		logger.warn('shipment_notifications.tables_repaired', { workspaceId });
	} catch (repairError) {
		logger.error('shipment_notifications.table_repair_failed', {
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

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function normalizePhone(value = '') {
	return normalizeWhatsAppIdentityPhone(value);
}

function normalizeDaysBack(value) {
	return Math.max(1, Math.min(Number(value || DEFAULT_DAYS_BACK) || DEFAULT_DAYS_BACK, 14));
}

async function resolveShipmentNotificationWorkspaceId(workspaceId = DEFAULT_WORKSPACE_ID) {
	const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;

	if (normalizedWorkspaceId !== DEFAULT_WORKSPACE_ID) {
		return normalizedWorkspaceId;
	}

	const hasDefaultData = await prisma.customerOrder.count({
		where: { workspaceId: normalizedWorkspaceId },
		take: 1,
	});

	if (hasDefaultData) {
		return normalizedWorkspaceId;
	}

	const workspaceWithOrders = await prisma.customerOrder.findFirst({
		where: {
			workspace: { status: 'ACTIVE' },
		},
		select: { workspaceId: true },
		orderBy: { updatedAt: 'desc' },
	});

	return workspaceWithOrders?.workspaceId || normalizedWorkspaceId;
}

function normalizeMapping(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value)
			.map(([key, source]) => [normalizeString(key), normalizeString(source)])
			.filter(([key, source]) => key && source)
	);
}

function subtractDays(days) {
	return new Date(Date.now() - normalizeDaysBack(days) * 24 * 60 * 60 * 1000);
}

function parseDateStart(value = null) {
	if (!value) return null;
	const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value = null) {
	if (!value) return null;
	const date = new Date(`${String(value).slice(0, 10)}T23:59:59.999Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function resolveDateRange({ daysBack = DEFAULT_DAYS_BACK, dateFrom = null, dateTo = null } = {}) {
	const from = parseDateStart(dateFrom) || subtractDays(daysBack);
	const to = parseDateEnd(dateTo) || new Date();
	return from <= to ? { from, to } : { from: to, to: from };
}

function buildRecentDateWhere(fields = [], { from, to }) {
	return fields.map((field) => ({ [field]: { gte: from, lte: to } }));
}

function hasTrackingUrl(value = '') {
	return Boolean(normalizeString(value));
}

function isDispatchReady({ status = '', trackingUrl = '' } = {}) {
	const shippingMeta = getShippingStatusMeta(status);
	if (shippingMeta.category === 'cancelled') return false;
	return isDispatchedShippingStatus(status, { includeDelivered: true }) || hasTrackingUrl(trackingUrl);
}

function getDispatchCandidateShippingMeta(status = '', trackingUrl = '') {
	const shippingMeta = getShippingStatusMeta(status);
	if (shippingMeta.category === 'cancelled' || shippingMeta.category === 'dispatched') {
		return shippingMeta;
	}
	return hasTrackingUrl(trackingUrl) ? getShippingStatusMeta('dispatched') : shippingMeta;
}

function getPrimaryProductName(products = []) {
	const product = safeArray(products)[0] || {};
	return normalizeString(
		product?.name ||
			product?.title ||
			product?.productName ||
			product?.variantName ||
			product?.sku ||
			'Producto'
	);
}

function getOrderProductSummary(order = {}) {
	const products = safeArray(order.products);
	return {
		productName: getPrimaryProductName(products),
		products,
	};
}

function getCandidateSourceValue(candidate = {}, key = '') {
	const contactName = normalizeString(candidate.contactName || '', candidate.phone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';
	const values = {
		first_name: firstName,
		contact_name: contactName,
		phone: candidate.phone || '',
		wa_id: candidate.phone || '',
		order_number: candidate.orderNumber || '',
		order_id: candidate.orderId || '',
		shipment_id: candidate.shipmentId || '',
		tracking_number: candidate.trackingNumber || '',
		tracking_url: candidate.trackingUrl || '',
		shipping_status: candidate.shippingStatus || '',
		shipping_method: candidate.shippingMethod || '',
		product_name: candidate.productName || '',
		first_product_name: candidate.productName || '',
		source: candidate.source || '',
		updated_at: candidate.updatedAt ? new Date(candidate.updatedAt).toISOString() : '',
	};
	return values[key] ?? '';
}

function buildCandidateVariables(candidate = {}, variableMapping = {}) {
	const contactName = normalizeString(candidate.contactName || '', candidate.phone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';
	const baseVariables = {
		'1': firstName,
		'2': candidate.orderNumber || candidate.orderId || '',
		'3': candidate.trackingUrl || '',
		'4': candidate.trackingNumber || '',
		'5': candidate.productName || '',
		contact_name: contactName,
		first_name: firstName,
		phone: candidate.phone || '',
		wa_id: candidate.phone || '',
		order_number: candidate.orderNumber || '',
		order_id: candidate.orderId || '',
		shipment_id: candidate.shipmentId || '',
		tracking_number: candidate.trackingNumber || '',
		tracking_url: candidate.trackingUrl || '',
		shipping_status: candidate.shippingStatus || '',
		shipping_method: candidate.shippingMethod || '',
		product_name: candidate.productName || '',
		first_product_name: candidate.productName || '',
	};
	const mapping = { ...DEFAULT_VARIABLE_MAPPING, ...normalizeMapping(variableMapping) };

	for (const [templateKey, sourceKey] of Object.entries(mapping)) {
		baseVariables[templateKey] = getCandidateSourceValue(candidate, sourceKey);
	}

	return baseVariables;
}

function serializeSetting(setting = null) {
	return {
		enabled: Boolean(setting?.enabled),
		templateId: setting?.templateLocalId || '',
		templateName: setting?.templateName || '',
		templateLanguage: setting?.templateLanguage || 'es_AR',
		variableMapping: normalizeMapping(setting?.variableMapping || {}),
		availableVariables: SHIPMENT_VARIABLE_OPTIONS,
		daysBack: normalizeDaysBack(setting?.daysBack || DEFAULT_DAYS_BACK),
		lastRunAt: setting?.lastRunAt || null,
		lastCampaignId: setting?.lastCampaignId || null,
		lastError: setting?.lastError || null,
		runCount: Number(setting?.runCount || 0),
	};
}

async function ensureSetting(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = await resolveShipmentNotificationWorkspaceId(workspaceId);
	let existing = null;

	try {
		existing = await prisma.shipmentNotificationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	} catch (error) {
		if (!isShipmentNotificationLogMissing(error)) throw error;
		await ensureShipmentNotificationLogTable(resolvedWorkspaceId);
		existing = await prisma.shipmentNotificationSetting.findUnique({
			where: { workspaceId: resolvedWorkspaceId },
		});
	}

	if (existing) return existing;

	return prisma.shipmentNotificationSetting.create({
		data: {
			workspaceId: resolvedWorkspaceId,
			enabled: false,
			daysBack: DEFAULT_DAYS_BACK,
		},
	});
}

export async function getShipmentNotificationSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	return serializeSetting(await ensureSetting(workspaceId));
}

export async function updateShipmentNotificationSettings({
	workspaceId = DEFAULT_WORKSPACE_ID,
	enabled = false,
	templateId = null,
	variableMapping = {},
	daysBack = DEFAULT_DAYS_BACK,
} = {}) {
	const resolvedWorkspaceId = await resolveShipmentNotificationWorkspaceId(workspaceId);
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

	if (Boolean(enabled) && !template) {
		throw new Error('Elegi una plantilla antes de activar los avisos de despacho.');
	}

	const setting = await prisma.shipmentNotificationSetting.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		create: {
			workspaceId: resolvedWorkspaceId,
			enabled: Boolean(enabled),
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			variableMapping: normalizeMapping(variableMapping),
			daysBack: normalizeDaysBack(daysBack),
		},
		update: {
			enabled: Boolean(enabled),
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
			variableMapping: normalizeMapping(variableMapping),
			daysBack: normalizeDaysBack(daysBack),
			lastError: null,
		},
	});

	return serializeSetting(setting);
}

async function getOrdersByNumber(workspaceId, orderNumbers = []) {
	const unique = [...new Set(orderNumbers.map((value) => normalizeString(value)).filter(Boolean))];
	if (!unique.length) return new Map();

	const orders = await prisma.customerOrder.findMany({
		where: {
			workspaceId,
			orderNumber: { in: unique },
		},
		orderBy: [{ orderUpdatedAt: 'desc' }, { updatedAt: 'desc' }],
	});

	const byNumber = new Map();
	for (const order of orders) {
		if (order.orderNumber && !byNumber.has(order.orderNumber)) {
			byNumber.set(order.orderNumber, order);
		}
	}

	return byNumber;
}

function shipmentToCandidate(shipment = {}, order = null, notifiedKeys = new Set()) {
	const phone = normalizePhone(shipment.recipientPhone || order?.normalizedPhone || order?.contactPhone || '');
	if (!phone) return null;

	const orderProducts = getOrderProductSummary(order || {});
	const notificationKey = `shipment:${shipment.didEnvio}`;
	const trackingUrl = shipment.trackingUrl || '';
	const shippingMeta = getDispatchCandidateShippingMeta(
		shipment.shippingStatus || order?.shippingStatus || '',
		trackingUrl
	);
	const alreadyNotified = notifiedKeys.has(notificationKey);

	return {
		notificationKey,
		source: 'enbox',
		alreadyNotified,
		statusCategory: shippingMeta.category,
		statusLabel: shippingMeta.label,
		reason: alreadyNotified ? 'Ya notificado' : 'Despacho detectado en Enbox',
		blockedReason: '',
		shipmentId: shipment.didEnvio,
		orderId: shipment.orderId || order?.orderId || '',
		orderNumber: shipment.orderNumber || order?.orderNumber || '',
		contactName: shipment.recipientName || order?.contactName || phone,
		phone,
		trackingNumber: shipment.trackingNumber || shipment.shipmentNumber || '',
		trackingUrl,
		shippingStatus: shippingMeta.label || shipment.shippingStatus || order?.shippingStatus || '',
		shippingMethod: shipment.shippingMethod || '',
		productName: orderProducts.productName,
		updatedAt: shipment.lastSyncedAt || shipment.updatedAt || shipment.createdAt,
		rawPayload: {
			source: 'enbox',
			shipmentId: shipment.didEnvio,
			orderId: shipment.orderId || order?.orderId || null,
			orderNumber: shipment.orderNumber || order?.orderNumber || null,
		},
	};
}

function orderToCandidate(order = {}, notifiedKeys = new Set(), shipment = null) {
	const phone = normalizePhone(order.normalizedPhone || order.contactPhone || '');
	if (!phone) return null;

	const notificationKey = shipment?.didEnvio ? `shipment:${shipment.didEnvio}` : `order:${order.orderId}`;
	const orderProducts = getOrderProductSummary(order);
	const shippingSignals = extractOrderShippingSignals(order.rawPayload || {});
	const trackingUrl = shipment?.trackingUrl || shippingSignals.trackingUrl || '';
	const shippingMeta = getDispatchCandidateShippingMeta(
		shipment?.shippingStatus || order.shippingStatus || '',
		trackingUrl
	);
	const alreadyNotified = notifiedKeys.has(notificationKey);

	return {
		notificationKey,
		source: shipment ? 'enbox' : 'tiendanube',
		alreadyNotified,
		statusCategory: shippingMeta.category,
		statusLabel: shippingMeta.label,
		reason: alreadyNotified
			? 'Ya notificado'
			: shipment
				? 'Despacho detectado en Enbox'
				: 'Despacho detectado en TiendaNube',
		blockedReason: '',
		shipmentId: shipment?.didEnvio || '',
		orderId: shipment?.orderId || order.orderId || '',
		orderNumber: order.orderNumber || '',
		contactName: order.contactName || phone,
		phone,
		trackingNumber: shipment?.trackingNumber || shipment?.shipmentNumber || shippingSignals.trackingNumber || '',
		trackingUrl,
		shippingStatus: shippingMeta.label || order.shippingStatus || '',
		shippingMethod: shipment?.shippingMethod || shippingSignals.carrierName || '',
		productName: orderProducts.productName,
		updatedAt: order.orderUpdatedAt || order.updatedAt || order.createdAt,
		rawPayload: {
			source: shipment ? 'enbox' : 'tiendanube',
			orderId: order.orderId || null,
			orderNumber: order.orderNumber || null,
			shipmentId: shipment?.didEnvio || null,
		},
	};
}

async function getNotifiedKeys(workspaceId, keys = []) {
	const unique = [...new Set(keys.filter(Boolean))];
	if (!unique.length) return new Set();

	let logs = [];
	try {
		logs = await prisma.shipmentNotificationLog.findMany({
			where: {
				workspaceId,
				notificationKey: { in: unique },
			},
			select: { notificationKey: true },
		});
	} catch (error) {
		if (!isShipmentNotificationLogMissing(error)) throw error;
		await ensureShipmentNotificationLogTable(workspaceId);
		logs = await prisma.shipmentNotificationLog.findMany({
			where: {
				workspaceId,
				notificationKey: { in: unique },
			},
			select: { notificationKey: true },
		});
	}

	return new Set(logs.map((log) => log.notificationKey));
}

async function getDispatchedOrderRefs(workspaceId) {
	const variants = getShippingStatusSearchTerms(['dispatched', 'delivered']);
	const shipments = await prisma.enboxShipment.findMany({
		where: {
			workspaceId,
			OR: variants.flatMap((value) => [
				{ shippingStatus: { contains: value, mode: 'insensitive' } },
				{ shippingStatusCode: { contains: value, mode: 'insensitive' } },
			]),
		},
		select: {
			orderId: true,
			orderNumber: true,
		},
		take: 5000,
	});

	return {
		orderIds: [...new Set(shipments.map((shipment) => normalizeString(shipment.orderId)).filter(Boolean))],
		orderNumbers: [...new Set(shipments.map((shipment) => normalizeString(shipment.orderNumber)).filter(Boolean))],
	};
}

function orderMatchesDispatchedRefs(order = {}, dispatchedOrderRefs = null) {
	return Boolean(
		(order.orderId && dispatchedOrderRefs?.orderIds?.includes(order.orderId)) ||
		(order.orderNumber && dispatchedOrderRefs?.orderNumbers?.includes(order.orderNumber))
	);
}

async function getShipmentsByOrderRefs(workspaceId, orders = []) {
	const orderIds = [...new Set(orders.map((order) => normalizeString(order.orderId)).filter(Boolean))];
	const orderNumbers = [...new Set(orders.map((order) => normalizeString(order.orderNumber)).filter(Boolean))];
	if (!orderIds.length && !orderNumbers.length) return new Map();
	const variants = getShippingStatusSearchTerms(['dispatched', 'delivered']);

	const shipments = await prisma.enboxShipment.findMany({
		where: {
			workspaceId,
			AND: [
				{
					OR: [
						...(orderIds.length ? [{ orderId: { in: orderIds } }] : []),
						...(orderNumbers.length ? [{ orderNumber: { in: orderNumbers } }] : []),
					],
				},
				{
					OR: variants.flatMap((value) => [
						{ shippingStatus: { contains: value, mode: 'insensitive' } },
						{ shippingStatusCode: { contains: value, mode: 'insensitive' } },
					]),
				},
			],
		},
		orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
	});

	const byRef = new Map();
	for (const shipment of shipments) {
		if (shipment.orderNumber && !byRef.has(`number:${shipment.orderNumber}`)) {
			byRef.set(`number:${shipment.orderNumber}`, shipment);
		}
		if (shipment.orderId && !byRef.has(`id:${shipment.orderId}`)) {
			byRef.set(`id:${shipment.orderId}`, shipment);
		}
	}
	return byRef;
}

function buildDispatchedOrderWhere({ workspaceId, range, dispatchedOrderRefs = null }) {
	const shippingStatusVariants = getShippingStatusSearchTerms(['dispatched', 'delivered']);
	const orderRefFilters = [];

	if (dispatchedOrderRefs?.orderIds?.length) {
		orderRefFilters.push({ orderId: { in: dispatchedOrderRefs.orderIds } });
	}
	if (dispatchedOrderRefs?.orderNumbers?.length) {
		orderRefFilters.push({ orderNumber: { in: dispatchedOrderRefs.orderNumbers } });
	}

	return {
		workspaceId,
		normalizedPhone: { not: null },
		OR: buildRecentDateWhere(['orderCreatedAt', 'orderUpdatedAt', 'updatedAt'], range),
		AND: [
			{
				OR: [
					...shippingStatusVariants.map((value) => ({
						shippingStatus: { contains: value, mode: 'insensitive' },
					})),
					...orderRefFilters,
				],
			},
		],
	};
}

export async function listShipmentNotificationCandidates({
	workspaceId = DEFAULT_WORKSPACE_ID,
	daysBack = DEFAULT_DAYS_BACK,
	dateFrom = null,
	dateTo = null,
	includeNotified = true,
	limit = 250,
} = {}) {
	const resolvedWorkspaceId = await resolveShipmentNotificationWorkspaceId(workspaceId);
	const range = resolveDateRange({ daysBack, dateFrom, dateTo });

	const shipments = await prisma.enboxShipment.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			OR: buildRecentDateWhere(['lastSyncedAt', 'updatedAt'], range),
		},
		orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
		take: Math.min(Number(limit) || 250, 500),
	});
	const dispatchedShipments = shipments.filter((shipment) =>
		isDispatchReady({ status: shipment.shippingStatus, trackingUrl: shipment.trackingUrl })
	);
	const ordersByNumber = await getOrdersByNumber(
		resolvedWorkspaceId,
		dispatchedShipments.map((shipment) => shipment.orderNumber)
	);
	const shipmentKeys = dispatchedShipments.map((shipment) => `shipment:${shipment.didEnvio}`);
	const dispatchedOrderRefs = await getDispatchedOrderRefs(resolvedWorkspaceId);

	const fallbackOrders = await prisma.customerOrder.findMany({
		where: buildDispatchedOrderWhere({
			workspaceId: resolvedWorkspaceId,
			range,
			dispatchedOrderRefs,
		}),
		orderBy: [{ orderUpdatedAt: 'desc' }, { updatedAt: 'desc' }],
		take: Math.min(Number(limit) || 250, 500),
	});
	const shipmentOrderNumbers = new Set(dispatchedShipments.map((shipment) => shipment.orderNumber).filter(Boolean));
	const shipmentOrderIds = new Set(dispatchedShipments.map((shipment) => shipment.orderId).filter(Boolean));
	const dispatchedFallbackOrders = fallbackOrders.filter((order) => {
		const shippingSignals = extractOrderShippingSignals(order.rawPayload || {});
		return (
			(isDispatchReady({ status: order.shippingStatus, trackingUrl: shippingSignals.trackingUrl }) ||
				orderMatchesDispatchedRefs(order, dispatchedOrderRefs)) &&
			!shipmentOrderNumbers.has(order.orderNumber) &&
			!shipmentOrderIds.has(order.orderId)
		);
	});
	const fallbackShipmentsByRef = await getShipmentsByOrderRefs(resolvedWorkspaceId, dispatchedFallbackOrders);
	const getFallbackShipment = (order) =>
		fallbackShipmentsByRef.get(`number:${order.orderNumber}`) || fallbackShipmentsByRef.get(`id:${order.orderId}`) || null;
	const orderKeys = dispatchedFallbackOrders.map((order) => {
		const shipment = getFallbackShipment(order);
		return shipment?.didEnvio ? `shipment:${shipment.didEnvio}` : `order:${order.orderId}`;
	});
	const notifiedKeys = await getNotifiedKeys(resolvedWorkspaceId, [...shipmentKeys, ...orderKeys]);

	const candidates = [
		...dispatchedShipments.map((shipment) =>
			shipmentToCandidate(shipment, ordersByNumber.get(shipment.orderNumber) || null, notifiedKeys)
		),
		...dispatchedFallbackOrders.map((order) => orderToCandidate(order, notifiedKeys, getFallbackShipment(order))),
	]
		.filter(Boolean)
		.filter((candidate) => includeNotified || !candidate.alreadyNotified)
		.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

	return {
		daysBack: normalizeDaysBack(daysBack),
		dateFrom: range.from.toISOString().slice(0, 10),
		dateTo: range.to.toISOString().slice(0, 10),
		summary: {
			ready: candidates.filter((candidate) => !candidate.alreadyNotified).length,
			alreadyNotified: candidates.filter((candidate) => candidate.alreadyNotified).length,
			withoutPhone:
				dispatchedShipments.filter((shipment) =>
					!normalizePhone(shipment.recipientPhone || ordersByNumber.get(shipment.orderNumber)?.normalizedPhone || ordersByNumber.get(shipment.orderNumber)?.contactPhone || '')
				).length +
				dispatchedFallbackOrders.filter((order) => !normalizePhone(order.normalizedPhone || order.contactPhone || '')).length,
		},
		candidates,
	};
}

function candidatesToRecipients(candidates = [], variableMapping = {}) {
	return safeArray(candidates).map((candidate) => ({
		contactName: candidate.contactName,
		phone: candidate.phone,
		waId: candidate.phone,
		externalKey: candidate.notificationKey,
		variables: buildCandidateVariables(candidate, variableMapping),
	}));
}

async function createAndLaunchShipmentCampaign({
	workspaceId,
	templateId,
	candidates,
	variableMapping = {},
	name = null,
	launchedByUserId = null,
} = {}) {
	const resolvedWorkspaceId = await resolveShipmentNotificationWorkspaceId(workspaceId);
	const template = await getTemplateOrThrow(templateId, { workspaceId: resolvedWorkspaceId });
	const usableCandidates = safeArray(candidates).filter((candidate) => !candidate.alreadyNotified);

	if (!usableCandidates.length) {
		throw new Error('No hay pedidos despachados pendientes para notificar.');
	}

	const created = await createCampaignDraft({
		workspaceId: resolvedWorkspaceId,
		name: normalizeString(name, `Aviso de despacho ${new Date().toISOString().slice(0, 10)}`),
		templateId: template.id,
		languageCode: template.language || 'es_AR',
		sendComponents: safeArray(template?.rawPayload?.components),
		recipients: candidatesToRecipients(usableCandidates, variableMapping),
		audienceSource: 'shipment_dispatch',
		audienceFilters: {
			source: 'shipment_dispatch',
			candidateKeys: usableCandidates.map((candidate) => candidate.notificationKey),
			variableMapping: normalizeMapping(variableMapping),
		},
		notes: 'Aviso de pedido despachado.',
		launchedByUserId,
	});
	const campaignId = created?.campaign?.id;

	if (campaignId) {
		await launchCampaign(campaignId, { workspaceId: resolvedWorkspaceId });
		const logRows = usableCandidates.map((candidate) => ({
			workspaceId: resolvedWorkspaceId,
			notificationKey: candidate.notificationKey,
			source: candidate.source,
			orderId: candidate.orderId || null,
			orderNumber: candidate.orderNumber || null,
			shipmentId: candidate.shipmentId || null,
			campaignId,
			recipientPhone: candidate.phone || null,
			rawPayload: candidate.rawPayload || null,
		}));
		try {
			await prisma.shipmentNotificationLog.createMany({
				data: logRows,
				skipDuplicates: true,
			});
		} catch (error) {
			if (!isShipmentNotificationLogMissing(error)) throw error;
			await ensureShipmentNotificationLogTable(resolvedWorkspaceId);
			await prisma.shipmentNotificationLog.createMany({
				data: logRows,
				skipDuplicates: true,
			});
		}
	}

	return {
		campaign: created?.campaign || null,
		campaignId,
		selectedCount: usableCandidates.length,
	};
}

export async function sendShipmentNotifications({
	workspaceId = DEFAULT_WORKSPACE_ID,
	templateId,
	candidateKeys = [],
	variableMapping = null,
	dateFrom = null,
	dateTo = null,
	launchedByUserId = null,
} = {}) {
	const resolvedWorkspaceId = await resolveShipmentNotificationWorkspaceId(workspaceId);
	const settings = await ensureSetting(resolvedWorkspaceId);
	const resolvedTemplateId = templateId || settings.templateLocalId;
	const candidatesResult = await listShipmentNotificationCandidates({
		workspaceId: resolvedWorkspaceId,
		daysBack: settings.daysBack || DEFAULT_DAYS_BACK,
		dateFrom,
		dateTo,
		includeNotified: true,
	});
	const keys = new Set(safeArray(candidateKeys));
	const selected = candidatesResult.candidates.filter((candidate) => keys.has(candidate.notificationKey));

	return createAndLaunchShipmentCampaign({
		workspaceId: resolvedWorkspaceId,
		templateId: resolvedTemplateId,
		candidates: selected,
		variableMapping: variableMapping ? normalizeMapping(variableMapping) : normalizeMapping(settings.variableMapping || {}),
		name: `Aviso despacho ${new Date().toISOString().slice(0, 10)}`,
		launchedByUserId,
	});
}

export async function processAutomaticShipmentNotifications({ workspaceId = null } = {}) {
	let settings = [];

	if (workspaceId) {
		settings = [await ensureSetting(workspaceId)];
	} else {
		try {
			settings = await prisma.shipmentNotificationSetting.findMany({ where: { enabled: true } });
		} catch (error) {
			if (!isShipmentNotificationLogMissing(error)) throw error;
			await ensureShipmentNotificationLogTable();
			settings = await prisma.shipmentNotificationSetting.findMany({ where: { enabled: true } });
		}
	}
	const results = [];

	for (const setting of settings) {
		if (!setting.enabled || !setting.templateLocalId) continue;

		try {
			const candidatesResult = await listShipmentNotificationCandidates({
				workspaceId: setting.workspaceId,
				daysBack: setting.daysBack || DEFAULT_DAYS_BACK,
				includeNotified: false,
				limit: AUTO_LIMIT,
			});

			if (!candidatesResult.candidates.length) {
				await prisma.shipmentNotificationSetting.update({
					where: { workspaceId: setting.workspaceId },
					data: { lastRunAt: new Date(), lastError: null },
				});
				results.push({ workspaceId: setting.workspaceId, processed: 0 });
				continue;
			}

			const result = await createAndLaunchShipmentCampaign({
				workspaceId: setting.workspaceId,
				templateId: setting.templateLocalId,
				candidates: candidatesResult.candidates,
				variableMapping: normalizeMapping(setting.variableMapping || {}),
				name: `Avisos despacho ${new Date().toISOString().slice(0, 10)}`,
				launchedByUserId: null,
			});

			await prisma.shipmentNotificationSetting.update({
				where: { workspaceId: setting.workspaceId },
				data: {
					lastRunAt: new Date(),
					lastCampaignId: result.campaignId || null,
					lastError: null,
					runCount: { increment: 1 },
				},
			});
			results.push({ workspaceId: setting.workspaceId, processed: result.selectedCount, campaignId: result.campaignId });
		} catch (error) {
			await prisma.shipmentNotificationSetting.update({
				where: { workspaceId: setting.workspaceId },
				data: {
					lastRunAt: new Date(),
					lastError: error.message || 'Error enviando avisos de despacho.',
				},
			});
			results.push({ workspaceId: setting.workspaceId, processed: 0, error: error.message });
		}
	}

	return {
		processed: results.reduce((sum, item) => sum + Number(item.processed || 0), 0),
		results,
	};
}
