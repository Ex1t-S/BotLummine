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

	const initials = String(cart.contactName || 'SN')
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
		productsPreview: productsList.map((p) => p.name).slice(0, 3)
	};
}

function buildPageUrl({ page, q, status, dateFrom, dateTo }) {
	const params = new URLSearchParams();

	if (page > 1) params.set('page', String(page));
	if (q?.trim()) params.set('q', q.trim());
	if (status && status !== 'ALL') params.set('status', status);
	if (dateFrom) params.set('dateFrom', dateFrom);
	if (dateTo) params.set('dateTo', dateTo);

	const queryString = params.toString();
	return `/dashboard/abandoned-carts${queryString ? `?${queryString}` : ''}`;
}

function buildPagination({ page, totalPages, q, status, dateFrom, dateTo }) {
	const pages = [];

	if (totalPages <= 1) {
		return {
			page,
			totalPages,
			pages: [],
			prevUrl: null,
			nextUrl: null,
			hasPrev: false,
			hasNext: false
		};
	}

	const maxVisible = 5;
	let start = Math.max(1, page - 2);
	let end = Math.min(totalPages, start + maxVisible - 1);

	if (end - start + 1 < maxVisible) {
		start = Math.max(1, end - maxVisible + 1);
	}

	for (let current = start; current <= end; current += 1) {
		pages.push({
			number: current,
			url: buildPageUrl({ page: current, q, status, dateFrom, dateTo }),
			isCurrent: current === page
		});
	}

	return {
		page,
		totalPages,
		pages,
		prevUrl: page > 1 ? buildPageUrl({ page: page - 1, q, status, dateFrom, dateTo }) : null,
		nextUrl: page < totalPages ? buildPageUrl({ page: page + 1, q, status, dateFrom, dateTo }) : null,
		hasPrev: page > 1,
		hasNext: page < totalPages
	};
}

export async function renderAbandonedCarts(req, res, next) {
	try {
		ensureAbandonedCartModel();

		const page = Math.max(1, Number(req.query.page || 1) || 1);
		const pageSize = 12;
		const q = String(req.query.q || req.query.search || '');
		const status = String(req.query.status || 'ALL').toUpperCase();
		const dateFrom = String(req.query.dateFrom || '');
		const dateTo = String(req.query.dateTo || '');

		const where = buildWhereClause({ q, status, dateFrom, dateTo });
		const skip = (page - 1) * pageSize;

		const [items, total, totalNew, totalContacted] = await Promise.all([
			prisma.abandonedCart.findMany({
				where,
				orderBy: [
					{ checkoutCreatedAt: 'desc' },
					{ updatedAt: 'desc' }
				],
				skip,
				take: pageSize
			}),
			prisma.abandonedCart.count({ where }),
			prisma.abandonedCart.count({ where: { status: 'NEW' } }),
			prisma.abandonedCart.count({ where: { status: 'CONTACTED' } })
		]);

		const carts = items.map(mapCartForView);
		const totalPages = Math.max(1, Math.ceil(total / pageSize));
		const safePage = Math.min(page, totalPages);

		const pagination = buildPagination({
			page: safePage,
			totalPages,
			q,
			status,
			dateFrom,
			dateTo
		});
		const syncWindow = [7, 15, 30].includes(Number(req.query.syncWindow))
	? Number(req.query.syncWindow)
	: 7;

		res.render('dashboard/abandoned-carts', {
			title: 'Carritos abandonados',
			appName: process.env.BUSINESS_NAME || 'Lummine',
			page: 'abandoned-carts',
			carts,
			filters: { q, status, dateFrom, dateTo },
			syncWindow,
			pagination: {
				...pagination,
				pageSize,
				total
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

		await syncAbandonedCarts(daysBack);
		return res.redirect(`/dashboard/abandoned-carts?syncWindow=${daysBack}`);
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
			return res.redirect('/dashboard/abandoned-carts');
		}

		const messageBody = String(body || '').trim() || buildSuggestedMessage(cart);
		const waId = normalizeThreadPhone(cart.contactPhone);

		if (!waId) {
			return res.redirect('/dashboard/abandoned-carts');
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
			return res.redirect('/dashboard/abandoned-carts');
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

		return res.redirect(`/dashboard/conversations/${conversation.id}?queue=HUMAN`);
	} catch (error) {
		next(error);
	}
}