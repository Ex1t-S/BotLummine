import { prisma } from '../lib/prisma.js';
import { syncAbandonedCarts } from '../services/carts/abandoned-cart.service.js';
import { filterRecoverableAbandonedCarts } from '../services/campaigns/campaign-attribution.service.js';
import {
	buildAbandonedCartVariables,
	buildSendComponentsFromTemplate,
	ensureApprovedTemplate,
} from '../services/campaigns/whatsapp-campaign.service.js';
import { getOrCreateConversation } from '../services/conversation/chat.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import { sendWhatsAppTemplate } from '../services/whatsapp/whatsapp.service.js';
import {
	getTemplateOrThrow,
	renderTemplatePreviewFromComponents,
} from '../services/whatsapp/whatsapp-template.service.js';
import {
	getWorkspaceRuntimeConfig,
	requireRequestWorkspaceId,
} from '../services/workspaces/workspace-context.service.js';

const FIXED_SYNC_WINDOW_DAYS = 30;

function ensureAbandonedCartModel() {
	if (!prisma?.abandonedCart) {
		throw new Error(
			'El modelo AbandonedCart no está disponible en Prisma Client. Ejecutá prisma generate y revisá el schema.'
		);
	}
}

function formatCurrency(value, currency = 'ARS') {
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: currency || 'ARS',
			maximumFractionDigits: 0
		}).format(Number(value || 0));
	} catch {
		return `${value || 0} ${currency || 'ARS'}`;
	}
}

function formatDateTime(value) {
	if (!value) return '';
	try {
		return new Date(value).toLocaleString('es-AR');
	} catch {
		return '';
	}
}

function buildLegacySuggestedMessage(cart) {
	return [
		`Hola ${cart.contactName || '¿cómo estás?'}, soy Sofi de Lummine 😊`,
		'Vimos que te quedó una compra pendiente y quería ayudarte a terminarla.',
		`Podés retomarlo desde acá: ${cart.abandonedCheckoutUrl || ''}`,
		'Si querés, también te asesoro por acá con talle, envío o pago.'
	].join('\n\n');
}

function buildSuggestedMessageForWorkspace(cart, workspaceConfig = null) {
	const businessName = workspaceConfig?.ai?.businessName || 'la marca';
	const agentName = workspaceConfig?.ai?.agentName || 'el equipo';

	return [
		`Hola ${cart.contactName || 'como estas?'}, soy ${agentName} de ${businessName}.`,
		'Vimos que te quedo una compra pendiente y queria ayudarte a terminarla.',
		`Podes retomarlo desde aca: ${cart.abandonedCheckoutUrl || ''}`,
		'Si queres, tambien te asesoro por aca con talle, envio o pago.'
	].join('\n\n');
}

function buildDateWindow({ dateFrom = '', dateTo = '', syncWindow = FIXED_SYNC_WINDOW_DAYS }) {
	const useManualDates = Boolean(dateFrom || dateTo);
	const window = {};

	if (useManualDates) {
		if (dateFrom) {
			window.gte = new Date(`${dateFrom}T00:00:00.000Z`);
		}

		if (dateTo) {
			window.lte = new Date(`${dateTo}T23:59:59.999Z`);
		}

		return Object.keys(window).length ? window : null;
	}

	if (Number(syncWindow) !== FIXED_SYNC_WINDOW_DAYS) {
		return null;
	}

	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - FIXED_SYNC_WINDOW_DAYS);
	window.gte = cutoff;
	return window;
}

function buildWhereClause({ q = '', status = 'ALL', dateFrom = '', dateTo = '', syncWindow = FIXED_SYNC_WINDOW_DAYS }) {
	const where = {};

	if (status && status !== 'ALL') {
		where.status = status;
	}

	if (q?.trim()) {
		const query = q.trim();

		where.OR = [
			{ contactName: { contains: query, mode: 'insensitive' } },
			{ contactEmail: { contains: query, mode: 'insensitive' } },
			{ contactPhone: { contains: query, mode: 'insensitive' } },
			{ checkoutId: { contains: query, mode: 'insensitive' } },
			{ shippingCity: { contains: query, mode: 'insensitive' } },
			{ shippingProvince: { contains: query, mode: 'insensitive' } }
		];
	}

	const dateWindow = buildDateWindow({ dateFrom, dateTo, syncWindow });
	if (dateWindow) {
		where.checkoutCreatedAt = dateWindow;
	}

	return where;
}

function mapCartForView(cart, workspaceConfig = null) {
	const rawProducts = Array.isArray(cart.products) ? cart.products : [];

	const productsList = rawProducts.map((product) => ({
		name: product?.name || product?.title || 'Producto sin nombre',
		quantity: Number(product?.quantity || 1)
	}));

	const initials =
		String(cart.contactName || 'SN')
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase() || '')
			.join('') || 'SN';

	return {
		...cart,
		initials,
		statusLabel: cart.status === 'CONTACTED' ? 'Contactado' : 'Nuevo',
		totalLabel: formatCurrency(cart.totalAmount, cart.currency || 'ARS'),
		productsCount: productsList.reduce((acc, item) => acc + Number(item.quantity || 0), 0),
		displayCreatedAt: formatDateTime(cart.checkoutCreatedAt || cart.createdAt),
		displayUpdatedAt: formatDateTime(cart.updatedAt),
		lastMessageSentLabel: cart.lastMessageSentAt ? formatDateTime(cart.lastMessageSentAt) : 'Nunca',
		suggestedMessage: buildSuggestedMessageForWorkspace(cart, workspaceConfig),
		productsList,
		productsPreview: productsList.map((p) => p.name).slice(0, 3),
		canOpenCart: !!cart.abandonedCheckoutUrl,
		canMessage: !!cart.contactPhone
	};
}

export async function getAbandonedCarts(req, res, next) {
	try {
		ensureAbandonedCartModel();
		const workspaceId = requireRequestWorkspaceId(req);

		const page = Math.max(1, Number(req.query.page || 1) || 1);
		const pageSize = 12;
		const q = String(req.query.q || '');
		const status = String(req.query.status || 'ALL').toUpperCase();
		const dateFrom = String(req.query.dateFrom || '');
		const dateTo = String(req.query.dateTo || '');
		const syncWindow = FIXED_SYNC_WINDOW_DAYS;

		const where = buildWhereClause({ q, status, dateFrom, dateTo, syncWindow });
		where.workspaceId = workspaceId;
		const statsBaseWhere = buildWhereClause({
			q,
			status: 'ALL',
			dateFrom,
			dateTo,
			syncWindow
		});
		statsBaseWhere.workspaceId = workspaceId;
		const skip = (page - 1) * pageSize;

		const [items, total, totalNew, totalContacted, workspaceConfig] = await Promise.all([
			prisma.abandonedCart.findMany({
				where,
				orderBy: [{ checkoutCreatedAt: 'desc' }, { updatedAt: 'desc' }],
				skip,
				take: pageSize
			}),
			prisma.abandonedCart.count({ where }),
			prisma.abandonedCart.count({ where: { ...statsBaseWhere, status: 'NEW' } }),
			prisma.abandonedCart.count({ where: { ...statsBaseWhere, status: 'CONTACTED' } }),
			getWorkspaceRuntimeConfig(workspaceId)
		]);

		const carts = items.map((cart) => mapCartForView(cart, workspaceConfig));
		const totalPages = Math.max(1, Math.ceil(total / pageSize));

		return res.json({
			ok: true,
			carts,
			filters: { q, status, dateFrom, dateTo, syncWindow },
			syncWindow,
			pagination: {
				page,
				pageSize,
				total,
				totalPages
			},
			stats: {
				total,
				totalNew,
				totalContacted,
				showingFrom: total ? skip + 1 : 0,
				showingTo: Math.min(skip + pageSize, total)
			}
		});
	} catch (error) {
		next(error);
	}
}

export async function postSyncAbandonedCarts(req, res) {
	try {
		ensureAbandonedCartModel();

		const daysBack = FIXED_SYNC_WINDOW_DAYS;

		const workspaceId = requireRequestWorkspaceId(req);
		const result = await syncAbandonedCarts(daysBack, { workspaceId });

		return res.json({
			ok: true,
			...result,
			deletedCount: Number(result.deletedCount ?? result.removedCount ?? 0),
			remainingCount: Number(result.remainingCount ?? 0),
			message: `Sync ${daysBack} días completada: ${result.syncedCount || result.count || 0} sincronizados y ${Number(result.deletedCount ?? result.removedCount ?? 0)} eliminados fuera de ventana.`
		});
	} catch (error) {
		console.error('[ABANDONED CARTS][SYNC ERROR]', error);
		return res.status(500).json({
			ok: false,
			error: error?.message || 'No se pudo sincronizar carritos abandonados.'
		});
	}
}

export async function postSendAbandonedCartMessage(req, res, next) {
	try {
		ensureAbandonedCartModel();
		const workspaceId = requireRequestWorkspaceId(req);

		const { id } = req.params;
		const { templateId } = req.body || {};

		if (!templateId) {
			return res.status(400).json({
				ok: false,
				error: 'ElegÃ­ una plantilla aprobada de Meta para enviar el carrito.'
			});
		}

		const cart = await prisma.abandonedCart.findFirst({
			where: { id, workspaceId }
		});

		if (!cart || !cart.contactPhone) {
			return res.status(404).json({
				ok: false,
				error: 'Carrito o teléfono no disponible'
			});
		}

		const [recoverableCart] = await filterRecoverableAbandonedCarts([cart], workspaceId);
		if (!recoverableCart) {
			return res.status(409).json({
				ok: false,
				error: 'Este carrito ya tiene una compra pagada o completada asociada.'
			});
		}

		const waId = normalizeThreadPhone(cart.contactPhone);

		if (!waId) {
			return res.status(400).json({
				ok: false,
				error: 'Número inválido para WhatsApp'
			});
		}

		const template = await getTemplateOrThrow(templateId, { workspaceId });
		ensureApprovedTemplate(template);

		const variables = buildAbandonedCartVariables(cart);
		const rendered = renderTemplatePreviewFromComponents(
			template?.rawPayload?.components || [],
			variables
		);
		const componentsToSend = buildSendComponentsFromTemplate({
			template,
			renderedComponents: rendered.components,
			variables
		});

		const conversation = await getOrCreateConversation({
			workspaceId,
			waId,
			contactName: cart.contactName || waId,
			queue: 'HUMAN',
			aiEnabled: false
		});

		const waResult = await sendWhatsAppTemplate({
			workspaceId,
			to: waId,
			templateName: template.name,
			languageCode: template.language || 'es_AR',
			components: componentsToSend
		});

		if (!waResult?.ok) {
			return res.status(400).json({
				ok: false,
				error: waResult?.error?.message || 'No se pudo enviar la plantilla'
			});
		}

		const workspaceConfig = await getWorkspaceRuntimeConfig(workspaceId);
		await prisma.message.create({
			data: {
				workspaceId,
				conversationId: conversation.id,
				metaMessageId: waResult?.rawPayload?.messages?.[0]?.id || null,
				senderName: workspaceConfig.ai.businessName || 'Marca',
				direction: 'OUTBOUND',
				type: 'template',
				body: rendered.previewText || `[Plantilla ${template.name}]`,
				provider: 'whatsapp-cloud-api',
				model: template.name,
				rawPayload: {
					...(waResult?.rawPayload || {}),
					source: 'abandoned-cart-recovery',
					abandonedCartId: cart.id,
					checkoutId: cart.checkoutId,
					templateId: template.id,
					templateName: template.name,
					templateLanguage: template.language || 'es_AR'
				}
			}
		});

		await prisma.abandonedCart.update({
			where: { id },
			data: {
				status: 'CONTACTED',
				contactedAt: new Date(),
				lastMessageSentAt: new Date(),
				contactPhone: waId
			}
		});

		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'HUMAN',
				aiEnabled: false,
				lastMessageAt: new Date()
			}
		});

		return res.json({
			ok: true,
			conversationId: conversation.id,
			templateName: template.name,
			templateLanguage: template.language || 'es_AR'
		});
	} catch (error) {
		next(error);
	}
}
