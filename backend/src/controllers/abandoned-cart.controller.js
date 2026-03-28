import { prisma } from '../lib/prisma.js';
import { syncAbandonedCarts } from '../services/abandoned-cart.service.js';
import { getOrCreateConversation, sendAndPersistOutbound } from '../services/chat.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';

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

function buildSuggestedMessage(cart) {
	return [
		`Hola ${cart.contactName || '¿cómo estás?'}, soy Sofi de Lummine 😊`,
		'Vimos que te quedó una compra pendiente y quería ayudarte a terminarla.',
		`Podés retomarlo desde acá: ${cart.abandonedCheckoutUrl || ''}`,
		'Si querés, también te asesoro por acá con talle, envío o pago.'
	].join('\n\n');
}

function buildWhereClause({ q = '', status = 'ALL', dateFrom = '', dateTo = '' }) {
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

	if (dateFrom || dateTo) {
		where.checkoutCreatedAt = {};

		if (dateFrom) {
			where.checkoutCreatedAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
		}

		if (dateTo) {
			where.checkoutCreatedAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
		}
	}

	return where;
}

function mapCartForView(cart) {
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
		suggestedMessage: buildSuggestedMessage(cart),
		productsList,
		productsPreview: productsList.map((p) => p.name).slice(0, 3),
		canOpenCart: !!cart.abandonedCheckoutUrl,
		canMessage: !!cart.contactPhone
	};
}

export async function getAbandonedCarts(req, res, next) {
	try {
		ensureAbandonedCartModel();

		const page = Math.max(1, Number(req.query.page || 1) || 1);
		const pageSize = 12;
		const q = String(req.query.q || '');
		const status = String(req.query.status || 'ALL').toUpperCase();
		const dateFrom = String(req.query.dateFrom || '');
		const dateTo = String(req.query.dateTo || '');
		const syncWindow = [7, 15, 30].includes(Number(req.query.syncWindow))
			? Number(req.query.syncWindow)
			: 7;

		const where = buildWhereClause({ q, status, dateFrom, dateTo });
		const skip = (page - 1) * pageSize;

		const [items, total, totalNew, totalContacted] = await Promise.all([
			prisma.abandonedCart.findMany({
				where,
				orderBy: [{ checkoutCreatedAt: 'desc' }, { updatedAt: 'desc' }],
				skip,
				take: pageSize
			}),
			prisma.abandonedCart.count({ where }),
			prisma.abandonedCart.count({ where: { status: 'NEW' } }),
			prisma.abandonedCart.count({ where: { status: 'CONTACTED' } })
		]);

		const carts = items.map(mapCartForView);
		const totalPages = Math.max(1, Math.ceil(total / pageSize));

		return res.json({
			ok: true,
			carts,
			filters: { q, status, dateFrom, dateTo },
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

export async function postSyncAbandonedCarts(req, res, next) {
	try {
		ensureAbandonedCartModel();

		const requestedDays = Number(req.body?.daysBack || 7);
		const daysBack = [7, 15, 30].includes(requestedDays) ? requestedDays : 7;

		const result = await syncAbandonedCarts(daysBack);

		return res.json({
			ok: true,
			...result,
			note: 'La sync no borra históricos. Solo crea/actualiza los carritos dentro de la ventana pedida.'
		});
	} catch (error) {
		next(error);
	}
}

export async function postSendAbandonedCartMessage(req, res, next) {
	try {
		ensureAbandonedCartModel();

		const { id } = req.params;
		const { body } = req.body || {};

		const cart = await prisma.abandonedCart.findUnique({
			where: { id }
		});

		if (!cart || !cart.contactPhone) {
			return res.status(404).json({
				ok: false,
				error: 'Carrito o teléfono no disponible'
			});
		}

		const messageBody = String(body || '').trim() || buildSuggestedMessage(cart);
		const waId = normalizeThreadPhone(cart.contactPhone);

		if (!waId) {
			return res.status(400).json({
				ok: false,
				error: 'Número inválido para WhatsApp'
			});
		}

		const conversation = await getOrCreateConversation({
			waId,
			contactName: cart.contactName || waId,
			queue: 'HUMAN',
			aiEnabled: false
		});

		const waResult = await sendAndPersistOutbound({
			conversationId: conversation.id,
			waId,
			body: messageBody,
			aiMeta: {
				provider: 'manual',
				model: null,
				raw: {
					source: 'abandoned-cart-recovery',
					abandonedCartId: cart.id,
					checkoutId: cart.checkoutId,
					normalizedPhone: waId
				}
			}
		});

		if (!waResult?.ok) {
			return res.status(400).json({
				ok: false,
				error: 'No se pudo enviar el mensaje'
			});
		}

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
			conversationId: conversation.id
		});
	} catch (error) {
		next(error);
	}
}