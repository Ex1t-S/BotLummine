import { prisma } from '../../lib/prisma.js';
import { normalizeWhatsAppIdentityPhone } from '../../lib/phone-normalization.js';
import { getTemplateOrThrow } from '../whatsapp/whatsapp-template.service.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import { createCampaignDraft, launchCampaign } from './whatsapp-campaign.service.js';

const DEFAULT_DAYS_BACK = 3;
const AUTO_LIMIT = 100;

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

function subtractDays(days) {
	return new Date(Date.now() - normalizeDaysBack(days) * 24 * 60 * 60 * 1000);
}

function normalizeStatusText(value = '') {
	return normalizeString(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function isDispatchedStatus(value = '') {
	const normalized = normalizeStatusText(value);
	return [
		'despach',
		'en camino',
		'en transito',
		'en tránsito',
		'shipped',
		'dispatched',
		'in_transit',
		'in transit',
		'on the way',
		'envio en curso',
	].some((needle) => normalized.includes(normalizeStatusText(needle)));
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

function buildCandidateVariables(candidate = {}) {
	const contactName = normalizeString(candidate.contactName || '', candidate.phone);
	const firstName = contactName.split(/\s+/).filter(Boolean)[0] || contactName || 'Hola';

	return {
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
		tracking_number: candidate.trackingNumber || '',
		tracking_url: candidate.trackingUrl || '',
		shipping_status: candidate.shippingStatus || '',
		shipping_method: candidate.shippingMethod || '',
		product_name: candidate.productName || '',
		first_product_name: candidate.productName || '',
	};
}

function serializeSetting(setting = null) {
	return {
		enabled: Boolean(setting?.enabled),
		templateId: setting?.templateLocalId || '',
		templateName: setting?.templateName || '',
		templateLanguage: setting?.templateLanguage || 'es_AR',
		daysBack: normalizeDaysBack(setting?.daysBack || DEFAULT_DAYS_BACK),
		lastRunAt: setting?.lastRunAt || null,
		lastCampaignId: setting?.lastCampaignId || null,
		lastError: setting?.lastError || null,
		runCount: Number(setting?.runCount || 0),
	};
}

async function ensureSetting(workspaceId = DEFAULT_WORKSPACE_ID) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const existing = await prisma.shipmentNotificationSetting.findUnique({
		where: { workspaceId: resolvedWorkspaceId },
	});

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
	daysBack = DEFAULT_DAYS_BACK,
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	let template = null;

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
			daysBack: normalizeDaysBack(daysBack),
		},
		update: {
			enabled: Boolean(enabled),
			templateLocalId: template?.id || null,
			templateName: template?.name || null,
			templateLanguage: template?.language || 'es_AR',
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

	return {
		notificationKey,
		source: 'enbox',
		alreadyNotified: notifiedKeys.has(notificationKey),
		shipmentId: shipment.didEnvio,
		orderId: shipment.orderId || order?.orderId || '',
		orderNumber: shipment.orderNumber || order?.orderNumber || '',
		contactName: shipment.recipientName || order?.contactName || phone,
		phone,
		trackingNumber: shipment.trackingNumber || shipment.shipmentNumber || '',
		trackingUrl: shipment.trackingUrl || '',
		shippingStatus: shipment.shippingStatus || order?.shippingStatus || '',
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

function orderToCandidate(order = {}, notifiedKeys = new Set()) {
	const phone = normalizePhone(order.normalizedPhone || order.contactPhone || '');
	if (!phone) return null;

	const notificationKey = `order:${order.orderId}`;
	const orderProducts = getOrderProductSummary(order);

	return {
		notificationKey,
		source: 'tiendanube',
		alreadyNotified: notifiedKeys.has(notificationKey),
		shipmentId: '',
		orderId: order.orderId || '',
		orderNumber: order.orderNumber || '',
		contactName: order.contactName || phone,
		phone,
		trackingNumber: '',
		trackingUrl: '',
		shippingStatus: order.shippingStatus || '',
		shippingMethod: '',
		productName: orderProducts.productName,
		updatedAt: order.orderUpdatedAt || order.updatedAt || order.createdAt,
		rawPayload: {
			source: 'tiendanube',
			orderId: order.orderId || null,
			orderNumber: order.orderNumber || null,
		},
	};
}

async function getNotifiedKeys(workspaceId, keys = []) {
	const unique = [...new Set(keys.filter(Boolean))];
	if (!unique.length) return new Set();

	const logs = await prisma.shipmentNotificationLog.findMany({
		where: {
			workspaceId,
			notificationKey: { in: unique },
		},
		select: { notificationKey: true },
	});

	return new Set(logs.map((log) => log.notificationKey));
}

export async function listShipmentNotificationCandidates({
	workspaceId = DEFAULT_WORKSPACE_ID,
	daysBack = DEFAULT_DAYS_BACK,
	includeNotified = true,
	limit = 250,
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const since = subtractDays(daysBack);

	const shipments = await prisma.enboxShipment.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			OR: [
				{ lastSyncedAt: { gte: since } },
				{ updatedAt: { gte: since } },
			],
		},
		orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
		take: Math.min(Number(limit) || 250, 500),
	});
	const dispatchedShipments = shipments.filter((shipment) => isDispatchedStatus(shipment.shippingStatus));
	const ordersByNumber = await getOrdersByNumber(
		resolvedWorkspaceId,
		dispatchedShipments.map((shipment) => shipment.orderNumber)
	);
	const shipmentKeys = dispatchedShipments.map((shipment) => `shipment:${shipment.didEnvio}`);

	const fallbackOrders = await prisma.customerOrder.findMany({
		where: {
			workspaceId: resolvedWorkspaceId,
			normalizedPhone: { not: null },
			OR: [
				{ orderUpdatedAt: { gte: since } },
				{ updatedAt: { gte: since } },
			],
		},
		orderBy: [{ orderUpdatedAt: 'desc' }, { updatedAt: 'desc' }],
		take: Math.min(Number(limit) || 250, 500),
	});
	const shipmentOrderNumbers = new Set(dispatchedShipments.map((shipment) => shipment.orderNumber).filter(Boolean));
	const dispatchedFallbackOrders = fallbackOrders.filter(
		(order) => isDispatchedStatus(order.shippingStatus) && !shipmentOrderNumbers.has(order.orderNumber)
	);
	const orderKeys = dispatchedFallbackOrders.map((order) => `order:${order.orderId}`);
	const notifiedKeys = await getNotifiedKeys(resolvedWorkspaceId, [...shipmentKeys, ...orderKeys]);

	const candidates = [
		...dispatchedShipments.map((shipment) =>
			shipmentToCandidate(shipment, ordersByNumber.get(shipment.orderNumber) || null, notifiedKeys)
		),
		...dispatchedFallbackOrders.map((order) => orderToCandidate(order, notifiedKeys)),
	]
		.filter(Boolean)
		.filter((candidate) => includeNotified || !candidate.alreadyNotified)
		.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

	return {
		daysBack: normalizeDaysBack(daysBack),
		candidates,
	};
}

function candidatesToRecipients(candidates = []) {
	return safeArray(candidates).map((candidate) => ({
		contactName: candidate.contactName,
		phone: candidate.phone,
		waId: candidate.phone,
		externalKey: candidate.notificationKey,
		variables: buildCandidateVariables(candidate),
	}));
}

async function createAndLaunchShipmentCampaign({
	workspaceId,
	templateId,
	candidates,
	name = null,
	launchedByUserId = null,
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
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
		recipients: candidatesToRecipients(usableCandidates),
		audienceSource: 'shipment_dispatch',
		audienceFilters: {
			source: 'shipment_dispatch',
			candidateKeys: usableCandidates.map((candidate) => candidate.notificationKey),
		},
		notes: 'Aviso de pedido despachado.',
		launchedByUserId,
	});
	const campaignId = created?.campaign?.id;

	if (campaignId) {
		await launchCampaign(campaignId, { workspaceId: resolvedWorkspaceId });
		await prisma.shipmentNotificationLog.createMany({
			data: usableCandidates.map((candidate) => ({
				workspaceId: resolvedWorkspaceId,
				notificationKey: candidate.notificationKey,
				source: candidate.source,
				orderId: candidate.orderId || null,
				orderNumber: candidate.orderNumber || null,
				shipmentId: candidate.shipmentId || null,
				campaignId,
				recipientPhone: candidate.phone || null,
				rawPayload: candidate.rawPayload || null,
			})),
			skipDuplicates: true,
		});
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
	launchedByUserId = null,
} = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const settings = await ensureSetting(resolvedWorkspaceId);
	const resolvedTemplateId = templateId || settings.templateLocalId;
	const candidatesResult = await listShipmentNotificationCandidates({
		workspaceId: resolvedWorkspaceId,
		daysBack: settings.daysBack || DEFAULT_DAYS_BACK,
		includeNotified: true,
	});
	const keys = new Set(safeArray(candidateKeys));
	const selected = candidatesResult.candidates.filter((candidate) => keys.has(candidate.notificationKey));

	return createAndLaunchShipmentCampaign({
		workspaceId: resolvedWorkspaceId,
		templateId: resolvedTemplateId,
		candidates: selected,
		name: `Aviso despacho ${new Date().toISOString().slice(0, 10)}`,
		launchedByUserId,
	});
}

export async function processAutomaticShipmentNotifications({ workspaceId = null } = {}) {
	const settings = workspaceId
		? [await ensureSetting(workspaceId)]
		: await prisma.shipmentNotificationSetting.findMany({ where: { enabled: true } });
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
