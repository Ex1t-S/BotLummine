import bcrypt from 'bcryptjs';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import { decryptSecret, encryptSecret } from '../lib/secret-crypto.js';
import {
	ensureWorkspaceAccess,
	getWorkspaceOrThrow,
	getWorkspacePublicPayload,
	isPlatformAdmin,
	requireRequestWorkspaceId,
	sanitizeCommerceConnection,
	sanitizeLogisticsConnection,
	sanitizeWhatsAppChannel,
} from '../services/workspaces/workspace-context.service.js';
import {
	getCatalogSummary,
	syncCatalogForWorkspace,
	syncCatalogFromProvider,
} from '../services/catalog/catalog.service.js';
import { getCampaignStats } from '../services/campaigns/campaign-stats.service.js';
import { generateWorkspaceBusinessContextDraft } from '../services/workspaces/workspace-context-draft.service.js';
import {
	assertWorkspaceFeatureFlagKey,
	listWorkspaceFeatureFlags,
	setWorkspaceFeatureFlag,
} from '../services/workspaces/workspace-feature-flags.service.js';
import { markPrimaryCommerceConnection, resolveActiveCommerceConnection } from '../services/commerce/active-commerce.service.js';
import { getShopifyClient } from '../services/shopify/client.js';
import { completeWhatsAppEmbeddedSignup } from '../services/whatsapp/whatsapp-embedded-signup.service.js';

const ACTIVE_CAMPAIGN_STATUSES = ['QUEUED', 'RUNNING'];
const DEFAULT_ESTIMATED_MESSAGE_COST_USD = Number(process.env.WHATSAPP_ESTIMATED_MESSAGE_COST_USD || 0);
const ANALYTICS_ACTIVITY_DAYS = 30;

function normalizeString(value = '') {
	return String(value || '').trim();
}

function normalizeSlug(value = '') {
	return normalizeString(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

function normalizeRole(value = '') {
	const role = normalizeString(value).toUpperCase();
	return ['ADMIN', 'AGENT', 'PLATFORM_ADMIN'].includes(role) ? role : 'AGENT';
}

function normalizeCommerceProvider(value = '') {
	const provider = normalizeString(value).toUpperCase();
	return ['TIENDANUBE', 'SHOPIFY'].includes(provider) ? provider : '';
}

function normalizeLogisticsProvider(value = '') {
	const provider = normalizeString(value).toUpperCase();
	return ['ENBOX'].includes(provider) ? provider : '';
}

function normalizeShopDomain(value = '') {
	return normalizeString(value)
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
}

function pickLocalized(value) {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'object') {
		return (
			value.es ||
			value['es_AR'] ||
			value['es-AR'] ||
			value.en ||
			Object.values(value).find((item) => typeof item === 'string') ||
			null
		);
	}
	return null;
}

function normalizeAssetUrl(value) {
	const raw = pickLocalized(value) || value?.src || value?.url || value;
	if (!raw || typeof raw !== 'string') return null;
	if (/^\/\//.test(raw)) return `https:${raw}`;
	return raw;
}

function pickShopifyBrandLogo(brand = {}) {
	return normalizeAssetUrl(
		brand?.logo?.image?.url ||
		brand?.logo?.url ||
		brand?.squareLogo?.image?.url ||
		brand?.squareLogo?.url ||
		null
	);
}

function pickShopifyBrandColor(color = {}) {
	return normalizeString(color?.background || color?.foreground || color?.hex || '');
}

function resolveUrlMaybeRelative(value = '', baseUrl = '') {
	const raw = normalizeAssetUrl(value);
	if (!raw) return null;
	try {
		return new URL(raw, baseUrl || undefined).toString();
	} catch {
		return raw;
	}
}

function readHtmlAttribute(tag = '', attribute = '') {
	const pattern = new RegExp(`${attribute}\\s*=\\s*([\"'])(.*?)\\1`, 'i');
	return tag.match(pattern)?.[2] || '';
}

function extractLogoFromStorefrontHtml(html = '', baseUrl = '') {
	const candidates = [];
	const pushCandidate = (url, score = 0) => {
		const resolved = resolveUrlMaybeRelative(url, baseUrl);
		if (!resolved) return;
		candidates.push({ url: resolved, score });
	};

	for (const match of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		const rel = readHtmlAttribute(tag, 'rel').toLowerCase();
		const href = readHtmlAttribute(tag, 'href');
		if (!href) continue;
		if (rel.includes('apple-touch-icon')) pushCandidate(href, 90);
		else if (rel.includes('icon')) pushCandidate(href, 80);
	}

	for (const match of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
		const tag = match[0];
		const property = (readHtmlAttribute(tag, 'property') || readHtmlAttribute(tag, 'name')).toLowerCase();
		const content = readHtmlAttribute(tag, 'content');
		if (!content) continue;
		if (property === 'og:logo') pushCandidate(content, 100);
		else if (property === 'og:image' || property === 'twitter:image') pushCandidate(content, 40);
	}

	for (const match of String(html || '').matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
		const url = match[0];
		if (/logo|brand|favicon|icon/i.test(url) && /\.(png|jpe?g|webp|svg|ico)(\?|$)/i.test(url)) {
			pushCandidate(url, /logo|brand/i.test(url) ? 95 : 70);
		}
	}

	const seen = new Set();
	return candidates
		.filter((item) => {
			if (seen.has(item.url)) return false;
			seen.add(item.url);
			return true;
		})
		.sort((a, b) => b.score - a.score)[0]?.url || null;
}

async function fetchStorefrontLogo(storeUrl = '') {
	if (!storeUrl) return null;
	try {
		const response = await axios.get(storeUrl, {
			timeout: 20000,
			headers: {
				'User-Agent': process.env.SHOPIFY_USER_AGENT || 'Multi tenant WhatsApp assistant',
				Accept: 'text/html,application/xhtml+xml',
			},
		});
		return extractLogoFromStorefrontHtml(response.data, storeUrl);
	} catch {
		return null;
	}
}

function shopifyFileUrl(value = '', shopDomain = '') {
	const raw = normalizeString(value);
	if (!raw) return null;
	if (/^https?:\/\//i.test(raw) || /^\/\//.test(raw)) return normalizeAssetUrl(raw);
	if (raw.startsWith('shopify://shop_images/')) {
		const fileName = raw.replace('shopify://shop_images/', '').split('/').map(encodeURIComponent).join('/');
		return `https://${shopDomain}/cdn/shop/files/${fileName}`;
	}
	if (/\.(png|jpe?g|webp|svg|gif|ico)(\?|$)/i.test(raw)) {
		const fileName = raw.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
		return `https://${shopDomain}/cdn/shop/files/${fileName}`;
	}
	return null;
}

function extractLogoFromThemeSettings(settings = {}, shopDomain = '') {
	const candidates = [];
	const walk = (value, path = []) => {
		if (typeof value === 'string') {
			const joinedPath = path.join('.').toLowerCase();
			const url = shopifyFileUrl(value, shopDomain);
			if (!url) return;
			let score = 0;
			if (joinedPath.includes('logo')) score += 100;
			if (joinedPath.includes('brand')) score += 80;
			if (joinedPath.includes('header')) score += 40;
			if (joinedPath.includes('image')) score += 20;
			if (joinedPath.includes('favicon')) score -= 40;
			if (/logo|brand/i.test(value)) score += 30;
			candidates.push({ url, score });
			return;
		}
		if (!value || typeof value !== 'object') return;
		for (const [key, nextValue] of Object.entries(value)) {
			walk(nextValue, [...path, key]);
		}
	};

	walk(settings);
	return candidates.sort((a, b) => b.score - a.score)[0]?.url || null;
}

async function fetchShopifyThemeLogo(client, shopDomain = '') {
	try {
		const themesResponse = await client.get('/themes.json');
		const themes = Array.isArray(themesResponse.data?.themes) ? themesResponse.data.themes : [];
		const theme = themes.find((item) => item.role === 'main') || themes[0];
		if (!theme?.id) return null;

		const assetResponse = await client.get(`/themes/${theme.id}/assets.json`, {
			params: { 'asset[key]': 'config/settings_data.json' },
		});
		const rawSettings = assetResponse.data?.asset?.value;
		const parsed = typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings;
		return extractLogoFromThemeSettings(parsed, shopDomain);
	} catch (error) {
		if (error?.response?.status === 403) {
			const permissionError = new Error('Shopify no permite leer el theme. Reinstalá la app para aceptar el permiso read_themes y después volvé a importar el logo.');
			permissionError.status = 403;
			throw permissionError;
		}
		return null;
	}
}

function getDatabaseHostFingerprint() {
	const rawUrl = String(process.env.DATABASE_URL || '').trim();
	if (!rawUrl) return null;

	try {
		const parsed = new URL(rawUrl);
		return {
			host: parsed.hostname,
			database: parsed.pathname.replace(/^\/+/, '') || null,
		};
	} catch {
		return { host: 'invalid-url', database: null };
	}
}

function assertPlatformAdmin(req) {
	if (!isPlatformAdmin(req.user)) {
		const error = new Error('Solo un superadmin puede realizar esta accion.');
		error.status = 403;
		throw error;
	}
}

function assertCanManageRole(req, role, targetUser = null) {
	if (isPlatformAdmin(req.user)) return;

	if (targetUser && normalizeRole(targetUser.role) !== 'AGENT') {
		const error = new Error('Un administrador de marca solo puede editar usuarios AGENT.');
		error.status = 403;
		throw error;
	}

	if (normalizeRole(role) !== 'AGENT') {
		const error = new Error('Un administrador de marca solo puede crear o asignar usuarios AGENT.');
		error.status = 403;
		throw error;
	}
}

function assertWorkspaceAdmin(req, workspaceId) {
	if (isPlatformAdmin(req.user)) return;
	if (req.user?.role !== 'ADMIN' || !ensureWorkspaceAccess(req, workspaceId)) {
		const error = new Error('No autorizado.');
		error.status = 403;
		throw error;
	}
}

function parseJsonObject(value, fallback = null) {
	if (value === undefined) return fallback;
	if (value === null || value === '') return null;
	if (typeof value === 'object' && !Array.isArray(value)) return value;

	try {
		const parsed = JSON.parse(String(value));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

function hasOwn(object = {}, key = '') {
	return Object.prototype.hasOwnProperty.call(object, key);
}

async function buildWorkspacePayload(workspaceId) {
	const workspace = await prisma.workspace.findUnique({
		where: { id: workspaceId },
		include: {
			branding: true,
			aiConfig: true,
			commerceConnections: {
				select: {
					id: true,
					provider: true,
					externalStoreId: true,
					shopDomain: true,
					scope: true,
					status: true,
					storeName: true,
					storeUrl: true,
					rawPayload: true,
					installedAt: true,
					updatedAt: true,
				},
			},
			logisticsConnections: {
				select: {
					id: true,
					provider: true,
					username: true,
					status: true,
					config: true,
					createdAt: true,
					updatedAt: true,
				},
				orderBy: { updatedAt: 'desc' },
			},
			storeInstallations: {
				select: {
					id: true,
					provider: true,
					storeId: true,
					scope: true,
					storeName: true,
					storeUrl: true,
					installedAt: true,
					updatedAt: true,
				},
			},
			whatsappChannels: {
				select: {
					id: true,
					name: true,
					wabaId: true,
					phoneNumberId: true,
					displayPhoneNumber: true,
					graphVersion: true,
					status: true,
					createdAt: true,
					updatedAt: true,
				},
				orderBy: { updatedAt: 'desc' },
			},
		},
	});

	return workspace ? getWorkspacePublicPayload(workspace) : null;
}

function toNumber(value) {
	if (value == null) return 0;
	if (typeof value === 'number') return value;
	if (typeof value.toNumber === 'function') return value.toNumber();
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLower(value = '') {
	return normalizeString(value).toLowerCase();
}

function normalizePhone(value = '') {
	return String(value || '').replace(/\D+/g, '');
}

function isPaidLikeStatus(value = '') {
	const status = normalizeLower(value);
	return ['paid', 'authorized', 'partially_paid', 'completed', 'fulfilled', 'closed'].includes(status);
}

function isMissingAutomationLogTable(error) {
	const message = String(error?.message || error || '');
	return (
		['P2021', 'P2022'].includes(error?.code) ||
		/AbandonedCartAutomationLog|public\.AbandonedCartAutomationLog/i.test(message)
	);
}

function subtractDays(days = 0) {
	return new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000);
}

function ratio(numerator = 0, denominator = 0) {
	const den = Number(denominator || 0);
	if (!den) return 0;
	return Number(((Number(numerator || 0) / den) * 100).toFixed(1));
}

function emptyAnalyticsMetrics() {
	return {
		campaignsCount: 0,
		activeCampaignsCount: 0,
		recipientsCount: 0,
		sentRecipientsCount: 0,
		deliveredRecipientsCount: 0,
		readRecipientsCount: 0,
		failedRecipientsCount: 0,
		billableRecipientsCount: 0,
		customersCount: 0,
		ordersCount: 0,
		revenueTotal: 0,
		currency: 'ARS',
		estimatedCampaignCostUsd: 0,
		messages30dInbound: 0,
		messages30dOutbound: 0,
		activeConversations30d: 0,
		unreadConversationsCount: 0,
		unreadMessagesCount: 0,
		readRate: 0,
		deliveryRate: 0,
		conversionCount: 0,
		attributedRevenue: 0,
		attributedCurrency: 'ARS',
		abandonedCartsCount: 0,
		contactedCartsCount: 0,
		recoveredCartsCount: 0,
		recoveredCartValue: 0,
	};
}

function applyEstimatedCost(metrics) {
	metrics.estimatedCampaignCostUsd = Number(
		(metrics.billableRecipientsCount * DEFAULT_ESTIMATED_MESSAGE_COST_USD).toFixed(2)
	);
	metrics.deliveryRate = ratio(metrics.deliveredRecipientsCount, metrics.sentRecipientsCount);
	metrics.readRate = ratio(metrics.readRecipientsCount, metrics.deliveredRecipientsCount || metrics.sentRecipientsCount);
	return metrics;
}

async function getDetectedRecoveredCartsByWorkspace(workspaceIds = []) {
	if (!workspaceIds.length) return new Map();

	const [carts, orders, automationLogs, campaignRecipients] = await Promise.all([
		prisma.abandonedCart.findMany({
			where: { workspaceId: { in: workspaceIds } },
			select: {
				id: true,
				workspaceId: true,
				storeId: true,
				checkoutId: true,
				token: true,
				contactEmail: true,
				contactPhone: true,
				status: true,
				totalAmount: true,
				contactedAt: true,
				lastMessageSentAt: true,
				recoveredAt: true,
				checkoutCreatedAt: true,
				createdAt: true,
			},
		}),
		prisma.customerOrder.findMany({
			where: { workspaceId: { in: workspaceIds } },
			select: {
				id: true,
				workspaceId: true,
				storeId: true,
				orderId: true,
				orderNumber: true,
				token: true,
				contactEmail: true,
				normalizedEmail: true,
				contactPhone: true,
				normalizedPhone: true,
				status: true,
				paymentStatus: true,
				orderCreatedAt: true,
				createdAt: true,
			},
		}),
		prisma.abandonedCartAutomationLog.findMany({
			where: { workspaceId: { in: workspaceIds } },
			select: {
				workspaceId: true,
				checkoutId: true,
				createdAt: true,
			},
		}).catch((error) => {
			if (isMissingAutomationLogTable(error)) return [];
			throw error;
		}),
		prisma.campaignRecipient.findMany({
			where: {
				workspaceId: { in: workspaceIds },
				externalKey: { startsWith: 'abandoned_cart:' },
				status: { in: ['SENT', 'DELIVERED', 'READ'] },
			},
			select: {
				workspaceId: true,
				externalKey: true,
				sentAt: true,
				deliveredAt: true,
				readAt: true,
			},
		}),
	]);

	const makeKey = (workspaceId, storeId, type, value) => {
		const normalized = type === 'phone' ? normalizePhone(value) : normalizeLower(value);
		if (!workspaceId || !normalized) return '';
		return [workspaceId, storeId || '', type, normalized].join('::');
	};
	const indexes = {
		checkout: new Map(),
		token: new Map(),
		email: new Map(),
		phone: new Map(),
	};
	const addToIndex = (type, key, order) => {
		if (!key) return;
		if (!indexes[type].has(key)) indexes[type].set(key, []);
		indexes[type].get(key).push(order);
	};
	const cartContactDatesByKey = new Map();
	const makeCartKey = (workspaceId, checkoutId) => [workspaceId || '', normalizeString(checkoutId || '')].join('::');
	const addCartContactDate = (workspaceId, checkoutId, date) => {
		if (!workspaceId || !checkoutId || !date) return;
		const key = makeCartKey(workspaceId, checkoutId);
		if (!cartContactDatesByKey.has(key)) cartContactDatesByKey.set(key, []);
		cartContactDatesByKey.get(key).push(date);
	};
	const getOrderAt = (order = {}) => order.orderCreatedAt || order.createdAt || null;

	for (const order of orders) {
		if (!isPaidLikeStatus(order.paymentStatus) && !isPaidLikeStatus(order.status)) continue;
		addToIndex('checkout', makeKey(order.workspaceId, order.storeId, 'checkout', order.orderId), order);
		addToIndex('checkout', makeKey(order.workspaceId, order.storeId, 'checkout', order.orderNumber), order);
		addToIndex('token', makeKey(order.workspaceId, order.storeId, 'token', order.token), order);
		addToIndex('email', makeKey(order.workspaceId, order.storeId, 'email', order.normalizedEmail || order.contactEmail), order);
		addToIndex('phone', makeKey(order.workspaceId, order.storeId, 'phone', order.normalizedPhone || order.contactPhone), order);
	}
	for (const log of automationLogs) {
		addCartContactDate(log.workspaceId, log.checkoutId, log.createdAt);
	}
	for (const recipient of campaignRecipients) {
		const checkoutId = normalizeString(String(recipient.externalKey || '').split(':').slice(1).join(':'));
		addCartContactDate(recipient.workspaceId, checkoutId, recipient.sentAt || recipient.deliveredAt || recipient.readAt);
	}

	const result = new Map(workspaceIds.map((workspaceId) => [workspaceId, { count: 0, value: 0 }]));
	const matchedCartIds = new Set();
	const getCartPaidOrders = (cart) => {
		const cartAt = cart.checkoutCreatedAt || cart.createdAt || null;
		const keys = [
			['checkout', makeKey(cart.workspaceId, cart.storeId, 'checkout', cart.checkoutId)],
			['token', makeKey(cart.workspaceId, cart.storeId, 'token', cart.token)],
			['email', makeKey(cart.workspaceId, cart.storeId, 'email', cart.contactEmail)],
			['phone', makeKey(cart.workspaceId, cart.storeId, 'phone', cart.contactPhone)],
		];
		const matchingOrders = [];
		for (const [type, key] of keys) {
			const candidates = indexes[type].get(key) || [];
			for (const order of candidates) {
				if (!cartAt || (getOrderAt(order) || new Date(0)) >= cartAt) {
					matchingOrders.push(order);
				}
			}
		}
		return [...new Map(matchingOrders.map((order) => [order.id, order])).values()].sort(
			(a, b) => new Date(getOrderAt(a) || 0).getTime() - new Date(getOrderAt(b) || 0).getTime()
		);
	};
	const cartHasContactBeforeOrder = (cart, order) => {
		const orderAt = getOrderAt(order) || cart.recoveredAt || null;
		if (!orderAt) return false;
		const contactDates = [
			cart.contactedAt,
			cart.lastMessageSentAt,
			...(cartContactDatesByKey.get(makeCartKey(cart.workspaceId, cart.checkoutId)) || []),
		].filter(Boolean);
		return contactDates.some((date) => new Date(date).getTime() <= new Date(orderAt).getTime());
	};

	for (const cart of carts) {
		const paidOrder = getCartPaidOrders(cart).find((order) => cartHasContactBeforeOrder(cart, order));
		if (!paidOrder || !cartHasContactBeforeOrder(cart, paidOrder)) continue;
		if (matchedCartIds.has(cart.id)) continue;
		matchedCartIds.add(cart.id);
		const metrics = result.get(cart.workspaceId) || { count: 0, value: 0 };
		metrics.count += 1;
		metrics.value += toNumber(cart.totalAmount);
		result.set(cart.workspaceId, metrics);
	}

	return result;
}

async function buildWorkspaceAnalyticsDetail(workspaceId) {
	if (!workspaceId) return null;

	const [
		recentCampaigns,
		campaignBillableRows,
		customersSummary,
		recentOrders,
		topCustomers,
	] = await Promise.all([
		prisma.campaign.findMany({
			where: { workspaceId },
			select: {
				id: true,
				name: true,
				templateName: true,
				status: true,
				totalRecipients: true,
				sentRecipients: true,
				deliveredRecipients: true,
				readRecipients: true,
				failedRecipients: true,
				startedAt: true,
				finishedAt: true,
				createdAt: true,
			},
			orderBy: { createdAt: 'desc' },
			take: 8,
		}),
		prisma.campaignRecipient.groupBy({
			by: ['campaignId'],
			where: { workspaceId, billable: true },
			_count: { _all: true },
		}),
		prisma.customerOrder.aggregate({
			where: { workspaceId },
			_count: { _all: true },
			_sum: { totalAmount: true },
		}),
		prisma.customerOrder.findMany({
			where: { workspaceId },
			select: {
				id: true,
				orderNumber: true,
				contactName: true,
				totalAmount: true,
				currency: true,
				status: true,
				paymentStatus: true,
				orderCreatedAt: true,
				createdAt: true,
			},
			orderBy: [{ orderCreatedAt: 'desc' }, { createdAt: 'desc' }],
			take: 8,
		}),
		prisma.customerProfile.findMany({
			where: { workspaceId },
			select: {
				id: true,
				displayName: true,
				email: true,
				phone: true,
				orderCount: true,
				totalSpent: true,
			},
			orderBy: { totalSpent: 'desc' },
			take: 8,
		}),
	]);

	const billableByCampaign = new Map(
		campaignBillableRows.map((row) => [row.campaignId, row._count?._all || 0])
	);

	return {
		campaigns: recentCampaigns.map((campaign) => {
			const billableRecipientsCount = billableByCampaign.get(campaign.id) || 0;
			return {
				...campaign,
				billableRecipientsCount,
				estimatedCostUsd: Number(
					(billableRecipientsCount * DEFAULT_ESTIMATED_MESSAGE_COST_USD).toFixed(2)
				),
			};
		}),
		customers: {
			ordersCount: customersSummary._count?._all || 0,
			revenueTotal: toNumber(customersSummary._sum?.totalAmount),
			recentOrders: recentOrders.map((order) => ({
				...order,
				totalAmount: toNumber(order.totalAmount),
			})),
			topCustomers: topCustomers.map((customer) => ({
				...customer,
				totalSpent: toNumber(customer.totalSpent),
			})),
		},
	};
}

export async function getWorkspaceCatalogStatus(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const catalog = await getCatalogSummary({ workspaceId });
		return res.json({ ok: true, catalog });
	} catch (error) {
		next(error);
	}
}

export async function runWorkspaceCatalogSync(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const requestedProvider = normalizeCommerceProvider(req.body?.provider || req.query?.provider || '');
		if ((req.body?.provider || req.query?.provider) && !requestedProvider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor invalido. Usa TIENDANUBE o SHOPIFY.',
			});
		}

		const result = requestedProvider
			? await syncCatalogFromProvider({ workspaceId, provider: requestedProvider })
			: await syncCatalogForWorkspace({ workspaceId });
		const catalog = await getCatalogSummary({ workspaceId });
		return res.json({ ok: true, result, catalog });
	} catch (error) {
		next(error);
	}
}

export async function syncWorkspaceBranding(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const requestedProvider = normalizeCommerceProvider(req.body?.provider || req.query?.provider || '');
		if ((req.body?.provider || req.query?.provider) && !requestedProvider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor invalido. Usa TIENDANUBE o SHOPIFY.',
			});
		}
		const activeConnection = requestedProvider
			? null
			: await resolveActiveCommerceConnection({ workspaceId });
		const provider = requestedProvider || activeConnection.provider;

		const connection = await prisma.commerceConnection.findUnique({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
		});

		const installation = await prisma.storeInstallation.findFirst({
			where: { workspaceId, provider },
			orderBy: { updatedAt: 'desc' },
		});

		const storeId = connection?.externalStoreId || installation?.storeId;
		const accessToken = connection?.accessToken
			? decryptSecret(connection.accessToken)
			: installation?.accessToken
				? decryptSecret(installation.accessToken)
				: '';

		if (!storeId || !accessToken) {
			return res.status(400).json({
				ok: false,
				error: provider === 'SHOPIFY'
					? 'Conecta Shopify antes de importar branding.'
					: 'Conecta Tienda Nube antes de importar branding.',
			});
		}

		let store = {};
		let storeName = null;
		let storeUrl = null;
		let logoUrl = null;
		let primaryColor = null;
		let secondaryColor = null;
		let accentColor = null;

		if (provider === 'SHOPIFY') {
			const { client, config } = await getShopifyClient({ workspaceId });
			const query = `
				query ShopBranding {
					shop {
						name
						myshopifyDomain
						primaryDomain { url host }
					}
				}
			`;
			const response = await client.post('/graphql.json', { query });
			if (response.data?.errors?.length) {
				throw new Error(response.data.errors.map((item) => item.message).filter(Boolean).join(' ') || 'No se pudo leer el branding de Shopify.');
			}
			const shop = response.data?.data?.shop || {};
			store = shop;
			storeName = normalizeString(shop.name) || connection?.storeName || config.storeName || null;
			storeUrl = shop.primaryDomain?.url || (shop.myshopifyDomain ? `https://${shop.myshopifyDomain}` : config.storeUrl);
			logoUrl =
				pickShopifyBrandLogo(shop.brand || {}) ||
				await fetchShopifyThemeLogo(client, config.shopDomain) ||
				await fetchStorefrontLogo(storeUrl);
			primaryColor = pickShopifyBrandColor(shop.brand?.colors?.primary);
			secondaryColor = pickShopifyBrandColor(shop.brand?.colors?.secondary);
			accentColor = secondaryColor || primaryColor;
		} else {
			const apiVersion = process.env.TIENDANUBE_API_VERSION || 'v1';
			const response = await axios.get(
				`https://api.tiendanube.com/${apiVersion}/${storeId}/store`,
				{
					headers: {
						Authentication: `bearer ${accessToken}`,
						'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Multi tenant WhatsApp assistant',
					},
					timeout: 20000,
				}
			);

			store = response.data || {};
			storeName = pickLocalized(store.name) || store.business_name || null;
			storeUrl =
				(Array.isArray(store.domains) && store.domains[0] ? `https://${store.domains[0]}` : null) ||
				(store.original_domain ? `https://${store.original_domain}` : null);
			logoUrl = normalizeAssetUrl(store.logo);
			const colors = store.colors || store.theme?.colors || {};
			primaryColor = colors.primary || colors.main || colors.brand || null;
			secondaryColor = colors.secondary || colors.background || null;
			accentColor = colors.accent || colors.button || null;
		}

		await prisma.workspaceBranding.upsert({
			where: { workspaceId },
			update: {
				logoUrl,
				primaryColor,
				secondaryColor,
				accentColor,
				rawProviderBranding: store,
			},
			create: {
				workspaceId,
				logoUrl,
				primaryColor,
				secondaryColor,
				accentColor,
				rawProviderBranding: store,
			},
		});

		if (storeName) {
			await prisma.workspaceAiConfig.upsert({
				where: { workspaceId },
				update: { businessName: storeName },
				create: {
					workspaceId,
					businessName: storeName,
					agentName: 'Sofi',
					tone: 'humana, directa y comercial',
				},
			});
		}

		await prisma.commerceConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			update: {
				storeName,
				storeUrl,
				rawPayload: {
					...(connection?.rawPayload && typeof connection.rawPayload === 'object' ? connection.rawPayload : {}),
					store,
				},
			},
			create: {
				workspaceId,
				provider,
				externalStoreId: String(storeId),
				shopDomain: provider === 'SHOPIFY' ? normalizeShopDomain(connection?.shopDomain || storeId) : null,
				accessToken: encryptSecret(accessToken),
				storeName,
				storeUrl,
				rawPayload: { store },
			},
		});

		const workspace = await buildWorkspacePayload(workspaceId);
		return res.json({
			ok: true,
			provider,
			branding: { storeName, storeUrl, logoUrl, primaryColor, secondaryColor, accentColor },
			workspace,
		});
	} catch (error) {
		next(error);
	}
}

export async function listWorkspaces(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const workspaces = await prisma.workspace.findMany({
			include: {
				branding: true,
				aiConfig: true,
				_count: {
					select: {
						users: true,
						contacts: true,
						campaigns: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		});

		return res.json({
			ok: true,
			workspaces: workspaces.map((workspace) => ({
				...getWorkspacePublicPayload(workspace),
				counts: workspace._count,
			})),
		});
	} catch (error) {
		next(error);
	}
}

export async function getPlatformDiagnostics(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const [
			workspaces,
			users,
			contacts,
			conversations,
			messages,
			catalogProducts,
			customerProfiles,
			customerOrders,
			abandonedCarts,
			campaigns,
			campaignRecipients,
		] = await Promise.all([
			prisma.workspace.count(),
			prisma.user.count(),
			prisma.contact.count(),
			prisma.conversation.count(),
			prisma.message.count(),
			prisma.catalogProduct.count(),
			prisma.customerProfile.count(),
			prisma.customerOrder.count(),
			prisma.abandonedCart.count(),
			prisma.campaign.count(),
			prisma.campaignRecipient.count(),
		]);

		return res.json({
			ok: true,
			database: getDatabaseHostFingerprint(),
			counts: {
				workspaces,
				users,
				contacts,
				conversations,
				messages,
				catalogProducts,
				customerProfiles,
				customerOrders,
				abandonedCarts,
				campaigns,
				campaignRecipients,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getWorkspaceFeatureFlags(req, res, next) {
	try {
		assertPlatformAdmin(req);
		const workspace = await getWorkspaceOrThrow(req.params.workspaceId);
		const flags = await listWorkspaceFeatureFlags(workspace.id);

		return res.json({
			ok: true,
			workspaceId: workspace.id,
			flags,
		});
	} catch (error) {
		next(error);
	}
}

export async function updateWorkspaceFeatureFlag(req, res, next) {
	try {
		assertPlatformAdmin(req);
		const workspace = await getWorkspaceOrThrow(req.params.workspaceId);
		const key = assertWorkspaceFeatureFlagKey(req.params.key);
		const enabled = Boolean(req.body?.enabled);
		const reason = normalizeString(req.body?.reason || '');
		const flag = await setWorkspaceFeatureFlag({
			workspaceId: workspace.id,
			key,
			enabled,
			reason,
			updatedById: req.user?.id || null,
		});

		return res.json({
			ok: true,
			workspaceId: workspace.id,
			flag,
			flags: await listWorkspaceFeatureFlags(workspace.id),
		});
	} catch (error) {
		next(error);
	}
}

export async function getWorkspaceAnalytics(req, res, next) {
	try {
		const platformAdmin = isPlatformAdmin(req.user);
		const requestedWorkspaceId = normalizeString(req.query?.workspaceId);
		const selectedWorkspaceId = platformAdmin
			? requestedWorkspaceId
			: normalizeString(req.user?.workspaceId);

		if (!platformAdmin && !selectedWorkspaceId) {
			return res.status(400).json({
				ok: false,
				error: 'No se pudo resolver el workspace de la solicitud.',
			});
		}

		const activitySince = subtractDays(ANALYTICS_ACTIVITY_DAYS);
		const workspaces = await prisma.workspace.findMany({
			where: platformAdmin ? undefined : { id: selectedWorkspaceId },
			select: {
				id: true,
				name: true,
				slug: true,
				status: true,
				createdAt: true,
				branding: {
					select: {
						logoUrl: true,
						primaryColor: true,
					},
				},
				aiConfig: {
					select: {
						businessName: true,
					},
				},
			},
			orderBy: { createdAt: 'desc' },
		});

		const workspaceIds = workspaces.map((workspace) => workspace.id);
		const [
			campaignRows,
			recipientRows,
			customerRows,
			orderRows,
			messageRows30d,
			activeConversationRows30d,
			unreadConversationRows,
			campaignStatsRows,
			recoveredCartMetrics,
			abandonedCartRows,
		] = await Promise.all([
			prisma.campaign.groupBy({
				by: ['workspaceId', 'status'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
			}),
			prisma.campaignRecipient.groupBy({
				by: ['workspaceId', 'status', 'billable'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
			}),
			prisma.customerProfile.groupBy({
				by: ['workspaceId'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
			}),
			prisma.customerOrder.groupBy({
				by: ['workspaceId', 'currency'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
				_sum: { totalAmount: true },
			}),
			prisma.message.groupBy({
				by: ['workspaceId', 'direction'],
				where: workspaceIds.length
					? { workspaceId: { in: workspaceIds }, createdAt: { gte: activitySince } }
					: { createdAt: { gte: activitySince } },
				_count: { _all: true },
			}),
			prisma.conversation.groupBy({
				by: ['workspaceId'],
				where: workspaceIds.length
					? { workspaceId: { in: workspaceIds }, lastMessageAt: { gte: activitySince } }
					: { lastMessageAt: { gte: activitySince } },
				_count: { _all: true },
			}),
			prisma.conversation.groupBy({
				by: ['workspaceId'],
				where: workspaceIds.length
					? { workspaceId: { in: workspaceIds }, unreadCount: { gt: 0 }, archivedAt: null }
					: { unreadCount: { gt: 0 }, archivedAt: null },
				_count: { _all: true },
				_sum: { unreadCount: true },
			}),
			Promise.all(
				workspaceIds.map(async (workspaceId) => ({
					workspaceId,
					stats: await getCampaignStats({ workspaceId }),
				}))
			),
			getDetectedRecoveredCartsByWorkspace(workspaceIds),
			prisma.abandonedCart.groupBy({
				by: ['workspaceId', 'status'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
				_sum: { totalAmount: true },
			}),
		]);

		const metricsByWorkspace = new Map(
			workspaceIds.map((workspaceId) => [workspaceId, emptyAnalyticsMetrics()])
		);

		for (const row of campaignRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			metrics.campaignsCount += count;
			if (ACTIVE_CAMPAIGN_STATUSES.includes(row.status)) {
				metrics.activeCampaignsCount += count;
			}
		}

		for (const row of recipientRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			metrics.recipientsCount += count;
			if (['SENT', 'DELIVERED', 'READ'].includes(row.status)) metrics.sentRecipientsCount += count;
			if (['DELIVERED', 'READ'].includes(row.status)) metrics.deliveredRecipientsCount += count;
			if (row.status === 'READ') metrics.readRecipientsCount += count;
			if (row.status === 'FAILED') metrics.failedRecipientsCount += count;
			if (row.billable === true) metrics.billableRecipientsCount += count;
		}

		for (const row of customerRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.customersCount = row._count?._all || 0;
		}

		for (const row of orderRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.ordersCount += row._count?._all || 0;
			metrics.revenueTotal += toNumber(row._sum?.totalAmount);
			if (row.currency) metrics.currency = row.currency;
		}

		for (const row of messageRows30d) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			if (row.direction === 'INBOUND') metrics.messages30dInbound += count;
			if (row.direction === 'OUTBOUND') metrics.messages30dOutbound += count;
		}

		for (const row of activeConversationRows30d) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.activeConversations30d = row._count?._all || 0;
		}

		for (const row of unreadConversationRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.unreadConversationsCount = row._count?._all || 0;
			metrics.unreadMessagesCount = row._sum?.unreadCount || 0;
		}

		for (const row of campaignStatsRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.conversionCount = Number(row.stats?.purchasedRecipients || 0);
		}

		for (const row of abandonedCartRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			metrics.abandonedCartsCount += count;
			if (['CONTACTED', 'RECOVERED'].includes(row.status)) metrics.contactedCartsCount += count;
		}

		for (const [workspaceId, recovered] of recoveredCartMetrics.entries()) {
			const metrics = metricsByWorkspace.get(workspaceId);
			if (!metrics) continue;
			metrics.recoveredCartsCount = recovered.count || 0;
			metrics.recoveredCartValue = recovered.value || 0;
			metrics.conversionCount += recovered.count || 0;
		}

		const workspaceAnalytics = workspaces.map((workspace) => ({
			workspace,
			metrics: applyEstimatedCost(metricsByWorkspace.get(workspace.id) || emptyAnalyticsMetrics()),
		}));

		const totals = applyEstimatedCost(workspaceAnalytics.reduce((acc, item) => {
			const metrics = item.metrics || {};
			acc.campaignsCount += metrics.campaignsCount || 0;
			acc.activeCampaignsCount += metrics.activeCampaignsCount || 0;
			acc.recipientsCount += metrics.recipientsCount || 0;
			acc.sentRecipientsCount += metrics.sentRecipientsCount || 0;
			acc.deliveredRecipientsCount += metrics.deliveredRecipientsCount || 0;
			acc.readRecipientsCount += metrics.readRecipientsCount || 0;
			acc.failedRecipientsCount += metrics.failedRecipientsCount || 0;
			acc.billableRecipientsCount += metrics.billableRecipientsCount || 0;
			acc.customersCount += metrics.customersCount || 0;
			acc.ordersCount += metrics.ordersCount || 0;
			acc.revenueTotal += metrics.revenueTotal || 0;
			acc.messages30dInbound += metrics.messages30dInbound || 0;
			acc.messages30dOutbound += metrics.messages30dOutbound || 0;
			acc.activeConversations30d += metrics.activeConversations30d || 0;
			acc.unreadConversationsCount += metrics.unreadConversationsCount || 0;
			acc.unreadMessagesCount += metrics.unreadMessagesCount || 0;
			acc.conversionCount += metrics.conversionCount || 0;
			acc.attributedRevenue += metrics.attributedRevenue || 0;
			acc.abandonedCartsCount += metrics.abandonedCartsCount || 0;
			acc.contactedCartsCount += metrics.contactedCartsCount || 0;
			acc.recoveredCartsCount += metrics.recoveredCartsCount || 0;
			acc.recoveredCartValue += metrics.recoveredCartValue || 0;
			if (metrics.currency) acc.currency = metrics.currency;
			if (metrics.attributedCurrency) acc.attributedCurrency = metrics.attributedCurrency;
			return acc;
		}, emptyAnalyticsMetrics()));

		const detailWorkspaceId = selectedWorkspaceId || workspaceAnalytics[0]?.workspace?.id || '';
		const detail = detailWorkspaceId
			? {
					workspaceId: detailWorkspaceId,
					...(await buildWorkspaceAnalyticsDetail(detailWorkspaceId)),
			  }
			: null;

		return res.json({
			ok: true,
			estimatedMessageCostUsd: DEFAULT_ESTIMATED_MESSAGE_COST_USD,
			activityWindowDays: ANALYTICS_ACTIVITY_DAYS,
			totals,
			workspaces: workspaceAnalytics,
			detail,
		});
	} catch (error) {
		next(error);
	}
}

export async function createWorkspace(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const name = normalizeString(req.body?.name);
		const slug = normalizeSlug(req.body?.slug || name);

		if (!name || !slug) {
			return res.status(400).json({
				ok: false,
				error: 'Nombre y slug son obligatorios.',
			});
		}

		const workspace = await prisma.workspace.create({
			data: {
				name,
				slug,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				aiConfig: {
					create: {
						businessName: normalizeString(req.body?.businessName) || name,
						agentName: normalizeString(req.body?.agentName) || 'Sofi',
						tone: normalizeString(req.body?.tone) || 'humana, directa y comercial',
						systemPrompt: normalizeString(req.body?.systemPrompt) || null,
						businessContext: normalizeString(req.body?.businessContext) || null,
					},
				},
				branding: {
					create: {
						logoUrl: normalizeString(req.body?.logoUrl) || null,
						primaryColor: normalizeString(req.body?.primaryColor) || null,
						secondaryColor: normalizeString(req.body?.secondaryColor) || null,
						accentColor: normalizeString(req.body?.accentColor) || null,
					},
				},
			},
			include: {
				branding: true,
				aiConfig: true,
			},
		});

		return res.status(201).json({
			ok: true,
			workspace: getWorkspacePublicPayload(workspace),
		});
	} catch (error) {
		next(error);
	}
}

export async function deleteWorkspace(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const workspaceId = requireRequestWorkspaceId(req, {
			allowDefaultForPlatformAdmin: Boolean(req.params?.workspaceId),
		});

		const workspace = await prisma.workspace.findUnique({
			where: { id: workspaceId },
			select: {
				id: true,
				name: true,
				slug: true,
				users: {
					select: {
						id: true,
						role: true,
					},
				},
			},
		});

		if (!workspace) {
			return res.status(404).json({
				ok: false,
				error: 'Workspace no encontrado.',
			});
		}

		const workspaceUserIds = (workspace.users || [])
			.filter((user) => user.role !== 'PLATFORM_ADMIN')
			.map((user) => user.id);

		await prisma.$transaction(async (tx) => {
			if (workspaceUserIds.length) {
				await tx.user.deleteMany({
					where: {
						id: { in: workspaceUserIds },
					},
				});
			}

			await tx.workspace.delete({
				where: { id: workspaceId },
			});
		});

		return res.json({
			ok: true,
			deletedWorkspace: {
				id: workspace.id,
				name: workspace.name,
				slug: workspace.slug,
				deletedUsersCount: workspaceUserIds.length,
			},
		});
	} catch (error) {
		next(error);
	}
}

export async function getWorkspace(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req, {
			allowDefaultForPlatformAdmin: Boolean(req.params?.workspaceId),
		});
		assertWorkspaceAdmin(req, workspaceId);

		const workspace = await buildWorkspacePayload(workspaceId);
		if (!workspace) {
			return res.status(404).json({ ok: false, error: 'Workspace no encontrado.' });
		}

		return res.json({ ok: true, workspace });
	} catch (error) {
		next(error);
	}
}

export async function generateWorkspaceContextDraft(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const result = await generateWorkspaceBusinessContextDraft(workspaceId, {
			websiteUrl: normalizeString(req.body?.websiteUrl) || ''
		});
		return res.json({
			ok: true,
			draft: result.draft,
			basis: result.basis,
			warnings: result.warnings,
			generation: result.generation
		});
	} catch (error) {
		next(error);
	}
}

export async function updateWorkspace(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const existingWorkspace = await getWorkspaceOrThrow(workspaceId);
		const platformAdmin = isPlatformAdmin(req.user);

		const updateData = {};
		if (platformAdmin) {
			if (req.body?.name !== undefined) updateData.name = normalizeString(req.body.name);
			if (req.body?.slug !== undefined) updateData.slug = normalizeSlug(req.body.slug);
			if (req.body?.status !== undefined) updateData.status = normalizeString(req.body.status).toUpperCase();
		}

		if (Object.keys(updateData).length) {
			await prisma.workspace.update({
				where: { id: workspaceId },
				data: updateData,
			});
		}

		if (!platformAdmin && req.body?.branding) {
			const branding = req.body.branding || {};
			const brandingData = {
				logoUrl: normalizeString(branding.logoUrl) || null,
			};

			await prisma.workspaceBranding.upsert({
				where: { workspaceId },
				update: brandingData,
				create: {
					workspaceId,
					...brandingData,
				},
			});
		}

		if (req.body?.aiConfig) {
			const ai = req.body.aiConfig || {};
			const aiUpdateData = {};
			const aiCreateData = {
				workspaceId,
				businessName: existingWorkspace.name || 'Marca',
				agentName: 'Sofi',
				tone: 'humana, directa y comercial',
			};

			if (platformAdmin && hasOwn(ai, 'businessName')) {
				aiUpdateData.businessName = normalizeString(ai.businessName) || undefined;
				aiCreateData.businessName = normalizeString(ai.businessName) || 'Marca';
			}

			if (hasOwn(ai, 'agentName')) {
				aiUpdateData.agentName = normalizeString(ai.agentName) || undefined;
				aiCreateData.agentName = normalizeString(ai.agentName) || 'Sofi';
			}

			if (hasOwn(ai, 'tone')) {
				aiUpdateData.tone = normalizeString(ai.tone) || undefined;
				aiCreateData.tone = normalizeString(ai.tone) || 'humana, directa y comercial';
			}

			if (platformAdmin && hasOwn(ai, 'systemPrompt')) {
				aiUpdateData.systemPrompt = normalizeString(ai.systemPrompt) || null;
				aiCreateData.systemPrompt = normalizeString(ai.systemPrompt) || null;
			}

			if (platformAdmin && hasOwn(ai, 'businessContext')) {
				aiUpdateData.businessContext = normalizeString(ai.businessContext) || null;
				aiCreateData.businessContext = normalizeString(ai.businessContext) || null;
			}

			if (hasOwn(ai, 'paymentConfig')) {
				aiUpdateData.paymentConfig = parseJsonObject(ai.paymentConfig, null);
				aiCreateData.paymentConfig = parseJsonObject(ai.paymentConfig, null);
			}

			if (platformAdmin && hasOwn(ai, 'policyConfig')) {
				aiUpdateData.policyConfig = parseJsonObject(ai.policyConfig, null);
				aiCreateData.policyConfig = parseJsonObject(ai.policyConfig, null);
			}

			if (platformAdmin && hasOwn(ai, 'catalogConfig')) {
				aiUpdateData.catalogConfig = parseJsonObject(ai.catalogConfig, null);
				aiCreateData.catalogConfig = parseJsonObject(ai.catalogConfig, null);
			}

			if (!Object.keys(aiUpdateData).length) {
				const workspace = await buildWorkspacePayload(workspaceId);
				return res.json({ ok: true, workspace });
			}

			await prisma.workspaceAiConfig.upsert({
				where: { workspaceId },
				update: aiUpdateData,
				create: aiCreateData,
			});
		}

		const workspace = await buildWorkspacePayload(workspaceId);
		return res.json({ ok: true, workspace });
	} catch (error) {
		next(error);
	}
}

export async function listWorkspaceUsers(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const users = await prisma.user.findMany({
			where: { workspaceId },
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
			orderBy: { createdAt: 'desc' },
		});

		return res.json({ ok: true, users });
	} catch (error) {
		next(error);
	}
}

export async function createWorkspaceUser(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const name = normalizeString(req.body?.name);
		const email = normalizeString(req.body?.email).toLowerCase();
		const password = normalizeString(req.body?.password);
		const role = normalizeRole(req.body?.role);
		assertCanManageRole(req, role);

		if (!name || !email || !password) {
			return res.status(400).json({
				ok: false,
				error: 'Nombre, email y password son obligatorios.',
			});
		}

		if (role === 'PLATFORM_ADMIN' && !isPlatformAdmin(req.user)) {
			return res.status(403).json({
				ok: false,
				error: 'Solo superadmin puede crear superadmins.',
			});
		}

		const passwordHash = await bcrypt.hash(password, 10);
		const user = await prisma.user.create({
			data: {
				name,
				email,
				passwordHash,
				role,
				workspaceId: role === 'PLATFORM_ADMIN' ? null : workspaceId,
			},
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return res.status(201).json({ ok: true, user });
	} catch (error) {
		next(error);
	}
}

export async function updateWorkspaceUser(req, res, next) {
	try {
		const userId = normalizeString(req.params.userId);
		const user = await prisma.user.findUnique({ where: { id: userId } });

		if (!user) {
			return res.status(404).json({ ok: false, error: 'Usuario no encontrado.' });
		}

		assertWorkspaceAdmin(req, user.workspaceId || '');
		assertCanManageRole(req, user.role, user);

		const data = {};
		if (req.body?.name !== undefined) data.name = normalizeString(req.body.name);
		if (req.body?.role !== undefined) {
			const role = normalizeRole(req.body.role);
			assertCanManageRole(req, role, user);
			data.role = role;
			data.workspaceId = role === 'PLATFORM_ADMIN' ? null : user.workspaceId;
		}
		if (req.body?.password) {
			data.passwordHash = await bcrypt.hash(normalizeString(req.body.password), 10);
		}

		const updated = await prisma.user.update({
			where: { id: userId },
			data,
			select: {
				id: true,
				name: true,
				email: true,
				role: true,
				workspaceId: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		return res.json({ ok: true, user: updated });
	} catch (error) {
		next(error);
	}
}

export async function upsertLogisticsConnection(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const provider = normalizeLogisticsProvider(req.params.provider || req.body?.provider);
		if (!provider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor logistico invalido. Usa ENBOX.',
			});
		}

		let username = normalizeString(req.body?.username);
		let password = normalizeString(req.body?.password);

		const existingConnection = await prisma.logisticsConnection.findUnique({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			select: { username: true, password: true },
		});

		if (!username && existingConnection?.username) username = existingConnection.username;
		if (!password && existingConnection?.password) password = decryptSecret(existingConnection.password);

		if (!username || !password) {
			return res.status(400).json({
				ok: false,
				error: 'username y password son obligatorios.',
			});
		}

		const config = {
			panelBaseUrl: normalizeString(req.body?.panelBaseUrl) || null,
			publicBaseUrl: normalizeString(req.body?.publicBaseUrl) || null,
			publicTrackingSalt: normalizeString(req.body?.publicTrackingSalt) || null,
			targetClientId: normalizeString(req.body?.targetClientId) || null,
			discoverySeedDid: normalizeString(req.body?.discoverySeedDid) || null,
		};

		const connection = await prisma.logisticsConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			update: {
				username,
				password: encryptSecret(password),
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				config,
			},
			create: {
				workspaceId,
				provider,
				username,
				password: encryptSecret(password),
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				config,
			},
		});

		return res.json({
			ok: true,
			connection: sanitizeLogisticsConnection(connection),
		});
	} catch (error) {
		next(error);
	}
}

export async function upsertWhatsAppChannel(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const channelId = normalizeString(req.params.channelId || req.body?.id);
		const data = {
			workspaceId,
			name: normalizeString(req.body?.name) || 'Canal principal',
			wabaId: normalizeString(req.body?.wabaId),
			phoneNumberId: normalizeString(req.body?.phoneNumberId),
			displayPhoneNumber: normalizeString(req.body?.displayPhoneNumber) || null,
			accessToken: normalizeString(req.body?.accessToken),
			verifyToken: normalizeString(req.body?.verifyToken) || null,
			graphVersion: normalizeString(req.body?.graphVersion) || null,
			status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
		};

		const existingChannel = channelId
			? await prisma.whatsAppChannel.findFirst({
					where: { id: channelId, workspaceId },
			  })
			: null;

		if (channelId && !existingChannel) {
			return res.status(404).json({
				ok: false,
				error: 'Canal de WhatsApp no encontrado para este workspace.',
			});
		}

		if (!data.accessToken && existingChannel?.accessToken) {
			data.accessToken = decryptSecret(existingChannel.accessToken);
		}

		if (!data.verifyToken && existingChannel?.verifyToken) {
			data.verifyToken = decryptSecret(existingChannel.verifyToken);
		}

		if (!data.wabaId || !data.phoneNumberId || !data.accessToken) {
			return res.status(400).json({
				ok: false,
				error: 'wabaId, phoneNumberId y accessToken son obligatorios.',
			});
		}

		if (!channelId) {
			const existingPhone = await prisma.whatsAppChannel.findUnique({
				where: { phoneNumberId: data.phoneNumberId },
				select: { workspaceId: true },
			});

			if (existingPhone?.workspaceId && existingPhone.workspaceId !== workspaceId) {
				return res.status(409).json({
					ok: false,
					error: 'Ese phoneNumberId ya esta asignado a otro workspace.',
				});
			}
		}

		const channel = channelId
			? await prisma.whatsAppChannel.update({
					where: { id: channelId },
					data: {
						...data,
						accessToken: encryptSecret(data.accessToken),
						verifyToken: data.verifyToken ? encryptSecret(data.verifyToken) : null,
					},
			  })
			: await prisma.whatsAppChannel.upsert({
					where: { phoneNumberId: data.phoneNumberId },
					update: {
						...data,
						accessToken: encryptSecret(data.accessToken),
						verifyToken: data.verifyToken ? encryptSecret(data.verifyToken) : null,
					},
					create: {
						...data,
						accessToken: encryptSecret(data.accessToken),
						verifyToken: data.verifyToken ? encryptSecret(data.verifyToken) : null,
					},
			  });

		return res.json({
			ok: true,
			channel: sanitizeWhatsAppChannel(channel),
		});
	} catch (error) {
		next(error);
	}
}

export async function completeWhatsAppEmbeddedSignupForWorkspace(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req, {
			allowDefaultForPlatformAdmin: Boolean(req.params?.workspaceId),
		});
		assertWorkspaceAdmin(req, workspaceId);

		const result = await completeWhatsAppEmbeddedSignup({
			code: req.body?.code,
			wabaId: req.body?.wabaId || req.body?.waba_id,
			phoneNumberId: req.body?.phoneNumberId || req.body?.phone_number_id,
			businessId: req.body?.businessId || req.body?.business_id,
		});

		const existingPhone = await prisma.whatsAppChannel.findUnique({
			where: { phoneNumberId: result.phoneNumberId },
			select: { id: true, workspaceId: true },
		});

		if (existingPhone?.workspaceId && existingPhone.workspaceId !== workspaceId) {
			return res.status(409).json({
				ok: false,
				error: 'Ese numero de WhatsApp ya esta conectado a otra marca.',
			});
		}

		const channelData = {
			workspaceId,
			name: result.phoneNumber?.verified_name || result.waba?.name || 'Canal principal',
			wabaId: result.wabaId,
			phoneNumberId: result.phoneNumberId,
			displayPhoneNumber: result.displayPhoneNumber || null,
			accessToken: encryptSecret(result.accessToken),
			verifyToken: null,
			graphVersion: result.graphVersion,
			status: 'ACTIVE',
			rawPayload: {
				source: 'embedded_signup',
				businessId: result.businessId || null,
				waba: result.waba || null,
				phoneNumber: result.phoneNumber || null,
				subscription: result.subscription || null,
				token: result.token || null,
				connectedByUserId: req.user?.id || null,
				connectedAt: new Date().toISOString(),
			},
		};

		const channel = await prisma.$transaction(async (tx) => {
			const connectedChannel = existingPhone?.id
				? await tx.whatsAppChannel.update({
						where: { id: existingPhone.id },
						data: channelData,
				  })
				: await tx.whatsAppChannel.create({
						data: channelData,
				  });

			await tx.whatsAppChannel.updateMany({
				where: {
					workspaceId,
					id: { not: connectedChannel.id },
					status: 'ACTIVE',
				},
				data: { status: 'DISABLED' },
			});

			return connectedChannel;
		});

		const workspace = await buildWorkspacePayload(workspaceId);

		return res.json({
			ok: true,
			channel: sanitizeWhatsAppChannel(channel),
			workspace,
		});
	} catch (error) {
		next(error);
	}
}

export async function upsertCommerceConnection(req, res, next) {
	try {
		const workspaceId = requireRequestWorkspaceId(req);
		assertWorkspaceAdmin(req, workspaceId);

		const provider = normalizeCommerceProvider(req.params.provider || req.body?.provider);
		if (!provider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor invalido. Usa TIENDANUBE o SHOPIFY.',
			});
		}

		const shopDomain = provider === 'SHOPIFY'
			? normalizeShopDomain(req.body?.shopDomain || req.body?.externalStoreId)
			: normalizeString(req.body?.shopDomain) || null;
		const externalStoreId = normalizeString(req.body?.externalStoreId) || shopDomain;
		let accessToken = normalizeString(req.body?.accessToken);

		const existingConnection = await prisma.commerceConnection.findUnique({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			select: { accessToken: true, refreshToken: true },
		});

		if (!accessToken && existingConnection?.accessToken) {
			accessToken = decryptSecret(existingConnection.accessToken);
		}
		const refreshToken = normalizeString(req.body?.refreshToken) ||
			(existingConnection?.refreshToken ? decryptSecret(existingConnection.refreshToken) : null);

		if (!externalStoreId || !accessToken) {
			return res.status(400).json({
				ok: false,
				error: 'externalStoreId y accessToken son obligatorios.',
			});
		}

		const existingExternal = await prisma.commerceConnection.findUnique({
			where: {
				provider_externalStoreId: {
					provider,
					externalStoreId,
				},
			},
			select: { workspaceId: true },
		});

		if (existingExternal?.workspaceId && existingExternal.workspaceId !== workspaceId) {
			return res.status(409).json({
				ok: false,
				error: 'Esa tienda ya esta conectada a otro workspace.',
			});
		}

		const connection = await prisma.commerceConnection.upsert({
			where: {
				workspaceId_provider: {
					workspaceId,
					provider,
				},
			},
			update: {
				externalStoreId,
				shopDomain,
				accessToken: encryptSecret(accessToken),
				refreshToken: refreshToken ? encryptSecret(refreshToken) : null,
				scope: normalizeString(req.body?.scope) || null,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				storeName: normalizeString(req.body?.storeName) || null,
				storeUrl: normalizeString(req.body?.storeUrl) || (shopDomain ? `https://${shopDomain}` : null),
				rawPayload: parseJsonObject(req.body?.rawPayload, {
					apiVersion: normalizeString(req.body?.apiVersion) || null,
				}),
			},
			create: {
				workspaceId,
				provider,
				externalStoreId,
				shopDomain,
				accessToken: encryptSecret(accessToken),
				refreshToken: refreshToken ? encryptSecret(refreshToken) : null,
				scope: normalizeString(req.body?.scope) || null,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				storeName: normalizeString(req.body?.storeName) || null,
				storeUrl: normalizeString(req.body?.storeUrl) || (shopDomain ? `https://${shopDomain}` : null),
				rawPayload: parseJsonObject(req.body?.rawPayload, {
					apiVersion: normalizeString(req.body?.apiVersion) || null,
				}),
			},
		});
		if (connection.status === 'ACTIVE') {
			await markPrimaryCommerceConnection(connection.id, { workspaceId });
		}

		return res.json({
			ok: true,
			connection: sanitizeCommerceConnection(connection),
		});
	} catch (error) {
		next(error);
	}
}
