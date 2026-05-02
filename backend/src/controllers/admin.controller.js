import bcrypt from 'bcryptjs';
import axios from 'axios';
import { prisma } from '../lib/prisma.js';
import {
	ensureWorkspaceAccess,
	getWorkspaceOrThrow,
	getWorkspacePublicPayload,
	isPlatformAdmin,
	requireRequestWorkspaceId,
} from '../services/workspaces/workspace-context.service.js';
import {
	getCatalogSummary,
	syncCatalogFromProvider,
} from '../services/catalog/catalog.service.js';

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

		const provider = normalizeCommerceProvider(req.body?.provider || req.query?.provider || 'TIENDANUBE');
		if (!provider) {
			return res.status(400).json({
				ok: false,
				error: 'Proveedor invalido. Usa TIENDANUBE o SHOPIFY.',
			});
		}

		const result = await syncCatalogFromProvider({ workspaceId, provider });
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

		const provider = normalizeCommerceProvider(req.body?.provider || req.query?.provider || 'TIENDANUBE');
		if (provider !== 'TIENDANUBE') {
			return res.status(400).json({
				ok: false,
				error: 'Por ahora la importacion automatica de branding esta disponible para TIENDANUBE.',
			});
		}

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
		const accessToken = connection?.accessToken || installation?.accessToken;

		if (!storeId || !accessToken) {
			return res.status(400).json({
				ok: false,
				error: 'Conecta Tienda Nube antes de importar branding.',
			});
		}

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

		const store = response.data || {};
		const storeName = pickLocalized(store.name) || store.business_name || null;
		const storeUrl =
			(Array.isArray(store.domains) && store.domains[0] ? `https://${store.domains[0]}` : null) ||
			(store.original_domain ? `https://${store.original_domain}` : null);
		const logoUrl = normalizeAssetUrl(store.logo);
		const colors = store.colors || store.theme?.colors || {};
		const primaryColor = colors.primary || colors.main || colors.brand || null;
		const secondaryColor = colors.secondary || colors.background || null;
		const accentColor = colors.accent || colors.button || null;

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
				accessToken,
				storeName,
				storeUrl,
				rawPayload: { store },
			},
		});

		const workspace = await buildWorkspacePayload(workspaceId);
		return res.json({
			ok: true,
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

export async function getWorkspaceAnalytics(req, res, next) {
	try {
		assertPlatformAdmin(req);

		const selectedWorkspaceId = normalizeString(req.query?.workspaceId);
		const activitySince = subtractDays(ANALYTICS_ACTIVITY_DAYS);
		const workspaces = await prisma.workspace.findMany({
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
			conversionRows,
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
			prisma.campaignConversion.groupBy({
				by: ['workspaceId', 'source', 'currency'],
				where: workspaceIds.length ? { workspaceId: { in: workspaceIds } } : undefined,
				_count: { _all: true },
				_sum: { amount: true },
			}),
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

		for (const row of conversionRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			metrics.conversionCount += row._count?._all || 0;
			metrics.attributedRevenue += toNumber(row._sum?.amount);
			if (row.currency) metrics.attributedCurrency = row.currency;
		}

		for (const row of abandonedCartRows) {
			const metrics = metricsByWorkspace.get(row.workspaceId);
			if (!metrics) continue;
			const count = row._count?._all || 0;
			metrics.abandonedCartsCount += count;
			if (['CONTACTED', 'RECOVERED'].includes(row.status)) metrics.contactedCartsCount += count;
			if (row.status === 'RECOVERED') {
				metrics.recoveredCartsCount += count;
				metrics.recoveredCartValue += toNumber(row._sum?.totalAmount);
			}
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

		if (platformAdmin && req.body?.branding) {
			const branding = req.body.branding || {};
			await prisma.workspaceBranding.upsert({
				where: { workspaceId },
				update: {
					logoUrl: normalizeString(branding.logoUrl) || null,
					primaryColor: normalizeString(branding.primaryColor) || null,
					secondaryColor: normalizeString(branding.secondaryColor) || null,
					accentColor: normalizeString(branding.accentColor) || null,
				},
				create: {
					workspaceId,
					logoUrl: normalizeString(branding.logoUrl) || null,
					primaryColor: normalizeString(branding.primaryColor) || null,
					secondaryColor: normalizeString(branding.secondaryColor) || null,
					accentColor: normalizeString(branding.accentColor) || null,
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
		if (!password && existingConnection?.password) password = existingConnection.password;

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
				password,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				config,
			},
			create: {
				workspaceId,
				provider,
				username,
				password,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				config,
			},
		});

		return res.json({
			ok: true,
			connection: {
				...connection,
				password: undefined,
			},
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
			data.accessToken = existingChannel.accessToken;
		}

		if (!data.verifyToken && existingChannel?.verifyToken) {
			data.verifyToken = existingChannel.verifyToken;
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
					data,
			  })
			: await prisma.whatsAppChannel.upsert({
					where: { phoneNumberId: data.phoneNumberId },
					update: data,
					create: data,
			  });

		return res.json({
			ok: true,
			channel: {
				...channel,
				accessToken: undefined,
			},
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
			accessToken = existingConnection.accessToken;
		}

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
				accessToken,
				refreshToken: normalizeString(req.body?.refreshToken) || null,
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
				accessToken,
				refreshToken: normalizeString(req.body?.refreshToken) || null,
				scope: normalizeString(req.body?.scope) || null,
				status: normalizeString(req.body?.status || 'ACTIVE').toUpperCase(),
				storeName: normalizeString(req.body?.storeName) || null,
				storeUrl: normalizeString(req.body?.storeUrl) || (shopDomain ? `https://${shopDomain}` : null),
				rawPayload: parseJsonObject(req.body?.rawPayload, {
					apiVersion: normalizeString(req.body?.apiVersion) || null,
				}),
			},
		});

		return res.json({
			ok: true,
			connection: {
				...connection,
				accessToken: undefined,
				refreshToken: undefined,
			},
		});
	} catch (error) {
		next(error);
	}
}
