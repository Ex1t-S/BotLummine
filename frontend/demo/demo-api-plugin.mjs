const DEMO_NOW = '2026-07-18T16:00:00.000Z';

const demoWorkspace = {
	id: 'workspace-demo-local',
	name: 'Lummine Demo',
	slug: 'lummine-demo-local',
	status: 'ACTIVE',
	demoMode: true,
	timezone: 'America/Argentina/Buenos_Aires',
	branding: null,
	aiConfig: {
		businessName: 'Lummine Demo',
		aiProfile: 'GENERIC_ECOMMERCE',
		vertical: 'ECOMMERCE',
	},
};

const demoUser = {
	id: 'user-demo-local',
	email: 'operaciones@example.test',
	name: 'Operador Demo',
	role: 'ADMIN',
	workspaceId: demoWorkspace.id,
	workspace: demoWorkspace,
};

function clone(value) {
	return structuredClone(value);
}

function createInitialState() {
	const conversations = [
		{
			id: 'conversation-demo-auto',
			queue: 'AUTO',
			aiEnabled: true,
			unreadCount: 3,
			hasUnread: true,
			lastMessageAt: '2026-07-18T15:42:00.000Z',
			contact: { name: 'Martina Demo', phone: '+54 11 0000 0101', profileImageUrl: '' },
			state: { lastDetectedIntent: 'PRODUCT_QUERY', lastUserGoal: 'Consultar stock de zapatillas', needsHuman: false },
			messages: [
				{ id: 'msg-auto-1', direction: 'INBOUND', body: 'Hola, ¿tienen las zapatillas Urban en talle 38?', type: 'text', createdAt: '2026-07-18T15:39:00.000Z' },
				{ id: 'msg-auto-2', direction: 'OUTBOUND', body: 'Sí, el modelo Urban está disponible en talle 38. ¿Querés que te muestre los colores?', type: 'text', createdAt: '2026-07-18T15:40:00.000Z' },
				{ id: 'msg-auto-3', direction: 'INBOUND', body: 'Dale, en colores oscuros si puede ser.', type: 'text', createdAt: '2026-07-18T15:42:00.000Z' },
			],
		},
		{
			id: 'conversation-demo-human',
			queue: 'HUMAN',
			aiEnabled: false,
			unreadCount: 1,
			hasUnread: true,
			lastMessageAt: '2026-07-18T15:25:00.000Z',
			contact: { name: 'Nicolás Demo', phone: '+54 11 0000 0102', profileImageUrl: '' },
			state: { lastDetectedIntent: 'ORDER_STATUS', lastUserGoal: 'Resolver demora del pedido DEMO-1042', needsHuman: true },
			messages: [
				{ id: 'msg-human-1', direction: 'INBOUND', body: 'Mi pedido de prueba figura sin movimiento desde ayer.', type: 'text', createdAt: '2026-07-18T15:25:00.000Z' },
			],
		},
		{
			id: 'conversation-demo-payment',
			queue: 'PAYMENT_REVIEW',
			aiEnabled: false,
			unreadCount: 2,
			hasUnread: true,
			lastMessageAt: '2026-07-18T14:58:00.000Z',
			contact: { name: 'Camila Demo', phone: '+54 11 0000 0103', profileImageUrl: '' },
			state: { lastDetectedIntent: 'PAYMENT_PROOF', lastUserGoal: 'Solicitar revisión humana de comprobante', needsHuman: true },
			messages: [
				{ id: 'msg-payment-1', direction: 'INBOUND', body: 'Adjunto un comprobante sintético para revisión manual.', type: 'text', createdAt: '2026-07-18T14:57:00.000Z' },
				{ id: 'msg-payment-2', direction: 'INBOUND', body: 'comprobante-demo.pdf', type: 'document', fileName: 'comprobante-demo.pdf', mimeType: 'application/pdf', createdAt: '2026-07-18T14:58:00.000Z' },
			],
		},
		{
			id: 'conversation-demo-auto-read',
			queue: 'AUTO',
			aiEnabled: true,
			unreadCount: 0,
			hasUnread: false,
			lastMessageAt: '2026-07-18T13:44:00.000Z',
			contact: { name: 'Sofía Demo', phone: '+54 11 0000 0104', profileImageUrl: '' },
			state: { lastDetectedIntent: 'SHIPPING_QUERY', lastUserGoal: 'Conocer tiempos de entrega', needsHuman: false },
			messages: [
				{ id: 'msg-read-1', direction: 'INBOUND', body: '¿Cuánto demora el envío de prueba a Rosario?', type: 'text', createdAt: '2026-07-18T13:40:00.000Z' },
				{ id: 'msg-read-2', direction: 'OUTBOUND', body: 'La entrega estimada es de 3 a 5 días hábiles.', type: 'text', createdAt: '2026-07-18T13:44:00.000Z' },
			],
		},
	];

	const templates = [
		{
			id: 'template-demo-approved', name: 'recuperacion_carrito_demo', language: 'es_AR', category: 'MARKETING', status: 'APPROVED',
			bodyText: 'Hola {{1}}, guardamos tu carrito. Podés retomarlo acá: {{2}}', headerFormat: 'TEXT', updatedAt: '2026-07-17T18:00:00.000Z',
			components: [{ type: 'BODY', text: 'Hola {{1}}, guardamos tu carrito. Podés retomarlo acá: {{2}}' }],
		},
		{
			id: 'template-demo-order', name: 'novedad_pedido_demo', language: 'es_AR', category: 'UTILITY', status: 'APPROVED',
			bodyText: 'Hola {{1}}, tenemos una novedad sobre tu pedido {{2}}.', headerFormat: 'NONE', updatedAt: '2026-07-16T16:00:00.000Z',
			components: [{ type: 'BODY', text: 'Hola {{1}}, tenemos una novedad sobre tu pedido {{2}}.' }],
		},
		{
			id: 'template-demo-pending', name: 'beneficio_invierno_demo', language: 'es_AR', category: 'MARKETING', status: 'PENDING',
			bodyText: 'Beneficio de prueba para clientes frecuentes.', headerFormat: 'IMAGE', updatedAt: '2026-07-18T12:00:00.000Z',
			components: [{ type: 'BODY', text: 'Beneficio de prueba para clientes frecuentes.' }],
		},
		{
			id: 'template-demo-event', name: 'recordatorio_evento_demo', language: 'es_AR', category: 'UTILITY', status: 'DRAFT',
			bodyText: 'Hola {{1}}, te recordamos que tu evento comienza el {{2}}.', headerFormat: 'TEXT', updatedAt: '2026-07-15T10:00:00.000Z',
			components: [{ type: 'BODY', text: 'Hola {{1}}, te recordamos que tu evento comienza el {{2}}.' }],
		},
	];

	const campaigns = [
		{
			id: 'campaign-demo-running', name: 'Clientes frecuentes · Julio', status: 'RUNNING', templateId: templates[0].id,
			templateName: templates[0].name, audienceSource: 'customers', createdAt: '2026-07-18T13:00:00.000Z', startedAt: '2026-07-18T13:05:00.000Z',
			totalRecipients: 120, sentCount: 98, deliveredCount: 91, readCount: 64, failedCount: 3, pendingCount: 19,
			analytics: { repliedRecipients: 18, replyRate: 0.15, effectiveReadRecipients: 64, effectiveReadRate: 0.533, purchasedRecipients: 7, purchaseRate: 0.058, attributedRevenue: 486000, attributedCurrency: 'ARS', conversionsBySource: { order: 5, chat: 2 } },
		},
		{
			id: 'campaign-demo-finished', name: 'Recuperación carritos · Semana 28', status: 'FINISHED', templateId: templates[0].id,
			templateName: templates[0].name, audienceSource: 'manual_segment', createdAt: '2026-07-14T13:00:00.000Z', startedAt: '2026-07-14T13:05:00.000Z', finishedAt: '2026-07-14T14:10:00.000Z',
			totalRecipients: 88, sentCount: 86, deliveredCount: 82, readCount: 61, failedCount: 2, pendingCount: 0,
			analytics: { repliedRecipients: 16, replyRate: 0.186, effectiveReadRecipients: 61, effectiveReadRate: 0.709, purchasedRecipients: 9, purchaseRate: 0.105, attributedRevenue: 721500, attributedCurrency: 'ARS', conversionsBySource: { order: 7, chat: 2 } },
			diagnostics: {
				failures: {
					totalFailed: 2,
					byReason: [{ key: 'template_payload', label: 'Plantilla o variables', action: 'Revisar cantidad y orden de variables renderizadas.', count: 2 }],
					byProviderCode: [{ code: '132000', message: 'Cantidad de parámetros incompatible con la plantilla.', count: 2 }],
					examples: [{ id: 'failure-demo-1', errorCode: '132000', reasonLabel: 'Plantilla o variables' }],
				},
				controls: { blockedReasons: [], riskLevel: 'warning', canRetryFailed: true },
			},
		},
		{
			id: 'campaign-demo-clean', name: 'Aviso de temporada · Completada', status: 'FINISHED', templateId: templates[1].id,
			templateName: templates[1].name, audienceSource: 'customers', createdAt: '2026-07-12T13:00:00.000Z', startedAt: '2026-07-12T13:05:00.000Z', finishedAt: '2026-07-12T13:40:00.000Z',
			totalRecipients: 40, sentCount: 40, deliveredCount: 39, readCount: 30, failedCount: 0, pendingCount: 0,
			analytics: { repliedRecipients: 8, replyRate: 0.2, effectiveReadRecipients: 30, effectiveReadRate: 0.75, purchasedRecipients: 2, purchaseRate: 0.05, attributedRevenue: 128000, attributedCurrency: 'ARS', conversionsBySource: { order: 2 } },
		},
		{
			id: 'campaign-demo-draft', name: 'Lanzamiento Urban · Borrador', status: 'DRAFT', templateId: templates[2].id,
			templateName: templates[2].name, audienceSource: 'segment', createdAt: '2026-07-18T11:30:00.000Z',
			totalRecipients: 45, sentCount: 0, deliveredCount: 0, readCount: 0, failedCount: 0, pendingCount: 45,
		},
	];

	const carts = [
		['cart-demo-1', 'Valentina Demo', '$ 184.900,00', 'NEW', 'Nuevo', '2026-07-18T13:20:00.000Z', 'Nunca', null, ['Zapatillas Urban · 38', 'Medias Trail']],
		['cart-demo-2', 'Tomás Demo', '$ 96.500,00', 'CONTACTED', 'Contactado', '2026-07-17T20:10:00.000Z', 'Hoy, 11:05', 'Operador Demo', ['Campera Nube · M']],
		['cart-demo-3', 'Lucía Demo', '$ 242.000,00', 'NEW', 'Nuevo', '2026-07-17T15:30:00.000Z', 'Nunca', null, ['Bota Sur · 39']],
		['cart-demo-4', 'Benjamín Demo', '$ 78.400,00', 'RECOVERED', 'Recuperado', '2026-07-15T18:00:00.000Z', '15/07, 16:22', 'Operador Demo', ['Remera Base · L']],
		['cart-demo-5', 'Agustina Demo', '$ 129.990,00', 'DISMISSED', 'Descartado', '2026-07-14T14:30:00.000Z', '14/07, 12:15', 'Operador Demo', ['Mochila City']],
	].map(([id, contactName, totalLabel, status, statusLabel, createdAt, lastMessageSentLabel, responsibleName, productsPreview], index) => ({
		id, contactName, contactPhone: `+54 11 0000 02${String(index + 1).padStart(2, '0')}`, contactEmail: `cliente${index + 1}@example.test`,
		checkoutCreatedAt: createdAt, createdAt, status, statusLabel, totalLabel, lastMessageSentLabel, responsibleName,
		canOpenCart: true, abandonedCheckoutUrl: `https://example.test/demo/cart/${id}`, productsPreview,
		displayCreatedAt: new Date(createdAt).toLocaleString('es-AR'), shippingCity: 'Ciudad Demo', shippingProvince: 'Provincia Demo',
	}));

	const menuSettings = {
		name: 'Menú de atención',
		config: {
			version: 1,
			mainMenuKey: 'MAIN',
			menus: [{
				key: 'MAIN',
				title: 'Menú principal',
				headerText: '¡Hola! ¿Cómo podemos ayudarte?',
				body: 'Elegí una opción y te llevamos al lugar correcto.',
				buttonText: 'Ver opciones',
				footerText: 'Podés volver al inicio cuando quieras.',
				sectionTitle: '¿Qué necesitás resolver?',
				isActive: true,
				sortOrder: 1,
				options: [
					{ id: 'menu-demo-products', title: 'Ver productos', description: 'Catálogo y recomendaciones', aliases: ['1', 'productos'], actionType: 'INTENT', actionValue: 'product', effectiveMessageBody: 'Quiero ver productos', statePatch: { salesStage: 'DISCOVERY' }, isActive: true, sortOrder: 1 },
					{ id: 'menu-demo-orders', title: 'Seguir mi pedido', description: 'Estado y entrega', aliases: ['2', 'pedido'], actionType: 'INTENT', actionValue: 'order_status', effectiveMessageBody: 'Quiero saber el estado de mi pedido', statePatch: {}, isActive: true, sortOrder: 2 },
					{ id: 'menu-demo-human', title: 'Hablar con una persona', description: 'Atención del equipo', aliases: ['3', 'humano'], actionType: 'HUMAN', actionValue: 'human', replyBody: 'Te conectamos con una persona del equipo.', statePatch: {}, isActive: true, sortOrder: 3 },
				],
			}],
		},
	};

	return {
		conversations,
		paymentActions: [{ id: 'payment-action-demo-1', conversationId: 'conversation-demo-payment', action: 'REQUEST_NEW_PROOF', previousQueue: 'PAYMENT_REVIEW', resultQueue: 'PAYMENT_REVIEW', reason: 'El archivo sintético anterior era ilegible.', actorUserId: demoUser.id, createdAt: '2026-07-18T13:30:00.000Z' }],
		templates,
		campaigns,
		carts,
		menuSettings,
		aiSession: { id: 'ai-session-demo-local', fixtureKey: 'blank', messages: [], createdAt: DEMO_NOW },
		sequence: 100,
	};
}

function initials(name = '') {
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function contactSummary(conversation) {
	const last = conversation.messages.at(-1) || {};
	return {
		conversationId: conversation.id,
		displayName: conversation.contact.name,
		phoneDisplay: conversation.contact.phone,
		preview: last.body || last.fileName || 'Sin mensajes',
		lastMessageAt: conversation.lastMessageAt,
		lastMessageDirection: last.direction || 'INBOUND',
		queue: conversation.queue,
		aiEnabled: conversation.aiEnabled,
		unreadCount: conversation.unreadCount,
		hasUnread: conversation.hasUnread,
		avatar: { initials: initials(conversation.contact.name) },
	};
}

function campaignRecipients(campaign) {
	const total = Math.min(Number(campaign.totalRecipients || 0), 24);
	return Array.from({ length: total }, (_, index) => {
		const ordinal = index + 1;
		const status = ordinal <= campaign.readCount ? 'READ'
			: ordinal <= campaign.deliveredCount ? 'DELIVERED'
				: ordinal <= campaign.sentCount ? 'SENT'
					: ordinal <= campaign.sentCount + campaign.failedCount ? 'FAILED' : 'PENDING';
		return {
			id: `${campaign.id}-recipient-${ordinal}`,
			name: `Destinatario Demo ${String(ordinal).padStart(2, '0')}`,
			phone: `+54 11 0001 ${String(ordinal).padStart(4, '0')}`,
			status,
			createdAt: campaign.createdAt,
			updatedAt: campaign.startedAt || campaign.createdAt,
		};
	});
}

function createCatalog() {
	return [
		{ id: 'product-demo-1', title: 'Zapatillas Urban', name: 'Zapatillas Urban', sku: 'DEMO-URBAN', price: 89900, priceLabel: '$ 89.900', stock: 14, status: 'ACTIVE', imageUrl: '' },
		{ id: 'product-demo-2', title: 'Campera Nube', name: 'Campera Nube', sku: 'DEMO-NUBE', price: 96500, priceLabel: '$ 96.500', stock: 8, status: 'ACTIVE', imageUrl: '' },
		{ id: 'product-demo-3', title: 'Bota Sur', name: 'Bota Sur', sku: 'DEMO-SUR', price: 121000, priceLabel: '$ 121.000', stock: 5, status: 'ACTIVE', imageUrl: '' },
		{ id: 'product-demo-4', title: 'Mochila City', name: 'Mochila City', sku: 'DEMO-CITY', price: 129990, priceLabel: '$ 129.990', stock: 11, status: 'ACTIVE', imageUrl: '' },
	];
}

function createCustomers() {
	return [
		{ id: 'customer-demo-1', name: 'Valentina Demo', email: 'valentina@example.test', phone: '+54 11 0000 0301', ordersCount: 4, totalSpent: 486000, totalSpentLabel: '$ 486.000', lastOrderAt: '2026-07-16T16:00:00.000Z', city: 'Ciudad Demo' },
		{ id: 'customer-demo-2', name: 'Tomás Demo', email: 'tomas@example.test', phone: '+54 11 0000 0302', ordersCount: 2, totalSpent: 193000, totalSpentLabel: '$ 193.000', lastOrderAt: '2026-07-11T12:00:00.000Z', city: 'Ciudad Demo' },
		{ id: 'customer-demo-3', name: 'Lucía Demo', email: 'lucia@example.test', phone: '+54 11 0000 0303', ordersCount: 6, totalSpent: 842500, totalSpentLabel: '$ 842.500', lastOrderAt: '2026-07-17T18:00:00.000Z', city: 'Ciudad Demo' },
		{ id: 'customer-demo-4', name: 'Benjamín Demo', email: 'benjamin@example.test', phone: '+54 11 0000 0304', ordersCount: 1, totalSpent: 78400, totalSpentLabel: '$ 78.400', lastOrderAt: '2026-07-15T15:00:00.000Z', city: 'Ciudad Demo' },
	];
}

function sendJson(res, payload, status = 200) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json; charset=utf-8');
	res.setHeader('Cache-Control', 'no-store');
	res.end(JSON.stringify(payload));
}

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	if (!chunks.length) return {};
	const raw = Buffer.concat(chunks).toString('utf8');
	if (!String(req.headers['content-type'] || '').includes('application/json')) return { body: '', fileName: 'archivo-demo' };
	try { return JSON.parse(raw); } catch { return {}; }
}

function automationSettings(templateId = 'template-demo-approved') {
	return { enabled: true, configured: true, templateId, variableMapping: {}, filters: { daysBack: 30 }, lastRunAt: '2026-07-18T12:20:00.000Z', lastError: null };
}

function computeCampaignStats(state) {
	return {
		templatesCount: state.templates.length,
		approvedTemplatesCount: state.templates.filter((item) => item.status === 'APPROVED').length,
		campaignsCount: state.campaigns.length,
		activeCampaignsCount: state.campaigns.filter((item) => ['RUNNING', 'QUEUED'].includes(item.status)).length,
		recipientsCount: state.campaigns.reduce((total, item) => total + Number(item.totalRecipients || 0), 0),
		sentRecipientsCount: state.campaigns.reduce((total, item) => total + Number(item.sentCount || 0), 0),
		purchasedRecipients: 16,
		conversionSignalRecipients: 34,
		attributedRevenue: 1207500,
		attributedCurrency: 'ARS',
		purchaseRate: 0.064,
		conversionSignalRate: 0.136,
		statusBreakdown: { RUNNING: 1, FINISHED: 1, DRAFT: 1 },
	};
}

function makeHandler(stateRef) {
	return async function handleDemoApi(req, res, next) {
		if (!req.url?.startsWith('/api')) return next();

		const url = new URL(req.url, 'http://demo.local');
		const pathname = url.pathname.replace(/^\/api/, '') || '/';
		const method = String(req.method || 'GET').toUpperCase();
		const state = stateRef.current;

		if (pathname === '/dashboard/inbox/stream') {
			res.statusCode = 200;
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');
			res.write('event: ready\ndata: {"demo":true}\n\n');
			const heartbeat = setInterval(() => res.write(': demo heartbeat\n\n'), 30000);
			req.on('close', () => clearInterval(heartbeat));
			return;
		}

		if (pathname === '/demo/status') return sendJson(res, { ok: true, demo: true, externalDelivery: false, fixtureVersion: 1 });
		if (pathname === '/demo/reset' && method === 'POST') {
			stateRef.current = createInitialState();
			return sendJson(res, { ok: true, demo: true, resetAt: new Date().toISOString() });
		}
		if (pathname === '/auth/me') return sendJson(res, { ok: true, user: demoUser, demo: true });
		if (pathname === '/auth/login') return sendJson(res, { ok: true, user: demoUser, demo: true });
		if (pathname === '/auth/logout') return sendJson(res, { ok: true, demo: true });

		if (pathname === '/dashboard/operations/summary') {
			return sendJson(res, {
				totals: { activeConversations30d: 34, messages30dInbound: 286, messages30dOutbound: 241, paymentReview: 1, unreadConversations: 3, unreadMessages: 6, abandonedCartsNew: 2 },
				workspaces: [{ workspace: demoWorkspace, metrics: { activeConversations30d: 34, unreadConversations: 3, paymentReview: 1, customersCount: 128, campaignsCount: state.campaigns.length }, issues: [{ id: 'issue-demo-sla', type: 'conversations', severity: 'warning', title: '2 conversaciones cerca del plazo', description: 'Revisá la bandeja humana antes de las 14:30.', count: 2, href: '/inbox/humano' }] }],
			});
		}

		if (pathname === '/dashboard/inbox' && method === 'GET') {
			const queue = String(url.searchParams.get('queue') || 'AUTO').toUpperCase();
			const read = String(url.searchParams.get('read') || 'ALL').toUpperCase();
			const search = String(url.searchParams.get('q') || '').toLowerCase();
			const counts = { ALL: state.conversations.length, AUTO: 0, HUMAN: 0, PAYMENT_REVIEW: 0 };
			state.conversations.forEach((item) => { counts[item.queue] = Number(counts[item.queue] || 0) + 1; });
			const filtered = state.conversations.filter((item) => {
				if (queue !== 'ALL' && item.queue !== queue) return false;
				if (read === 'UNREAD' && !item.hasUnread) return false;
				if (read === 'READ' && item.hasUnread) return false;
				return !search || `${item.contact.name} ${item.contact.phone} ${item.messages.at(-1)?.body || ''}`.toLowerCase().includes(search);
			}).sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));
			const contacts = filtered.map(contactSummary);
			return sendJson(res, { ok: true, contacts, counts, nextOffset: null, selectedContact: contacts[0] || null, demo: true });
		}

		const conversationMatch = pathname.match(/^\/dashboard\/conversations\/([^/]+)(?:\/(.*))?$/);
		if (conversationMatch) {
			const conversation = state.conversations.find((item) => item.id === conversationMatch[1]);
			const action = conversationMatch[2] || '';
			if (!conversation) return sendJson(res, { ok: false, error: 'Conversación demo no encontrada.' }, 404);
			if (action === 'messages' && method === 'GET') return sendJson(res, { ok: true, conversation: { ...conversation, messagesPage: { limit: 80, hasMore: false, nextBefore: null } }, demo: true });
			if (action === 'messages' && method === 'POST') {
				const body = await readBody(req);
				const message = { id: `msg-demo-${++state.sequence}`, direction: 'OUTBOUND', body: body.body || 'Archivo sintético adjunto', type: body.fileName ? 'document' : 'text', fileName: body.fileName || undefined, createdAt: new Date().toISOString() };
				conversation.messages.push(message);
				conversation.lastMessageAt = message.createdAt;
				return sendJson(res, { ok: true, message, demo: true, deliveredExternally: false }, 201);
			}
			if (action === 'read' && method === 'PATCH') { conversation.unreadCount = 0; conversation.hasUnread = false; return sendJson(res, { ok: true, unreadCount: 0, lastReadAt: new Date().toISOString(), demo: true }); }
			if (action === 'unread' && method === 'PATCH') { conversation.unreadCount = 1; conversation.hasUnread = true; return sendJson(res, { ok: true, unreadCount: 1, demo: true }); }
			if (action === 'queue' && method === 'PATCH') { const body = await readBody(req); conversation.queue = body.queue || conversation.queue; conversation.aiEnabled = conversation.queue === 'AUTO'; return sendJson(res, { ok: true, conversationId: conversation.id, queue: conversation.queue, aiEnabled: conversation.aiEnabled, demo: true }); }
			if (action === 'payment-review/actions' && method === 'GET') return sendJson(res, { ok: true, actions: state.paymentActions.filter((item) => item.conversationId === conversation.id), demo: true });
			if (action === 'payment-review/actions' && method === 'POST') { const body = await readBody(req); const recorded = { id: `payment-action-demo-${++state.sequence}`, conversationId: conversation.id, action: body.action || 'HANDOFF', previousQueue: conversation.queue, resultQueue: 'HUMAN', reason: body.reason || '', actorUserId: demoUser.id, createdAt: new Date().toISOString() }; state.paymentActions.unshift(recorded); conversation.queue = 'HUMAN'; conversation.aiEnabled = false; return sendJson(res, { ok: true, action: recorded, conversationId: conversation.id, queue: 'HUMAN', replayed: false, demo: true }, 201); }
			if (action === 'reset-context' && method === 'PATCH') { conversation.state = { lastDetectedIntent: null, lastUserGoal: null, needsHuman: conversation.queue !== 'AUTO' }; return sendJson(res, { ok: true, demo: true }); }
			if (action === 'history' && method === 'DELETE') { conversation.messages = []; return sendJson(res, { ok: true, demo: true }); }
		}

		if (pathname === '/dashboard/abandoned-carts' && method === 'GET') {
			const total = state.carts.length;
			return sendJson(res, { ok: true, carts: state.carts, stats: { total, totalNew: state.carts.filter((item) => item.status === 'NEW').length, totalContacted: state.carts.filter((item) => item.status === 'CONTACTED').length, showingFrom: total ? 1 : 0, showingTo: total }, pagination: { page: 1, totalPages: 1, total }, demo: true });
		}
		if (pathname === '/dashboard/abandoned-carts/sync' && method === 'POST') return sendJson(res, { ok: true, daysBack: 30, syncedCount: state.carts.length, deletedCount: 0, remainingCount: state.carts.length, message: 'Fixtures de carritos actualizados localmente.', demo: true });

		const catalog = createCatalog();
		if (pathname === '/dashboard/catalog' && method === 'GET') return sendJson(res, { items: catalog, products: catalog, total: catalog.length, page: 1, totalPages: 1, demo: true });
		if (pathname === '/dashboard/catalog/sync' && method === 'POST') return sendJson(res, { ok: true, totalProducts: catalog.length, demo: true });
		const customers = createCustomers();
		if (pathname === '/dashboard/customers' && method === 'GET') return sendJson(res, { customers, items: customers, stats: { totalOrders: 13, totalCustomers: customers.length, withPhone: customers.length, avgTicket: 123456, totalSpent: 1599900 }, pagination: { page: 1, totalPages: 1, total: customers.length, totalItems: customers.length, pageSize: 25 }, demo: true });
		if (pathname === '/dashboard/customers/sync-status') return sendJson(res, { running: false, message: 'Datos demo listos.', pagesFetched: 1, ordersFetched: 13, ordersUpserted: 13, warnings: [], errors: [], activeWindow: { label: 'Últimos 30 días' }, demo: true });
		if (pathname === '/dashboard/customers/sync' && method === 'POST') return sendJson(res, { running: false, message: 'Sincronización demo completada.', ordersFetched: 13, ordersUpserted: 13, demo: true });

		if (pathname === '/campaigns/stats') return sendJson(res, { stats: computeCampaignStats(state), demo: true });
		if (pathname === '/campaigns/templates' && method === 'GET') return sendJson(res, { templates: state.templates, items: state.templates, demo: true });
		if (pathname === '/campaigns/templates' && method === 'POST') { const body = await readBody(req); const template = { id: `template-demo-${++state.sequence}`, name: body.name || `plantilla_demo_${state.sequence}`, language: body.language || 'es_AR', category: body.category || 'MARKETING', status: 'DRAFT', bodyText: body.bodyText || body.body || '', components: body.components || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; state.templates.unshift(template); return sendJson(res, { template, demo: true }, 201); }
		if (pathname === '/campaigns/templates/sync' && method === 'POST') return sendJson(res, { ok: true, syncedCount: state.templates.length, markedDeletedCount: 0, deletedCount: 0, demo: true });
		if (pathname === '/campaigns/templates/purge-deleted' && method === 'POST') return sendJson(res, { ok: true, deletedCount: 0, demo: true });
		const templateMatch = pathname.match(/^\/campaigns\/templates\/([^/]+)$/);
		if (templateMatch) { const index = state.templates.findIndex((item) => item.id === templateMatch[1]); if (index < 0) return sendJson(res, { error: 'Plantilla demo no encontrada.' }, 404); if (method === 'PATCH') { const body = await readBody(req); state.templates[index] = { ...state.templates[index], ...body, id: state.templates[index].id, updatedAt: new Date().toISOString() }; return sendJson(res, { template: state.templates[index], demo: true }); } if (method === 'DELETE') { state.templates.splice(index, 1); return sendJson(res, { ok: true, demo: true }); } }

		if (pathname === '/campaigns' && method === 'GET') {
			const campaigns = state.campaigns.map(({ sentCount, deliveredCount, readCount, failedCount, pendingCount, ...campaign }) => ({
				...campaign,
				sentRecipients: sentCount,
				deliveredRecipients: deliveredCount,
				readRecipients: readCount,
				failedRecipients: failedCount,
				pendingRecipients: pendingCount,
			}));
			return sendJson(res, { campaigns, items: campaigns, demo: true });
		}
		if (pathname === '/campaigns' && method === 'POST') { const body = await readBody(req); const template = state.templates.find((item) => item.id === body.templateId); const campaign = { id: `campaign-demo-${++state.sequence}`, name: body.name || `Campaña demo ${state.sequence}`, status: 'DRAFT', templateId: body.templateId || template?.id || state.templates[0]?.id, templateName: template?.name || state.templates[0]?.name, audienceSource: body.audienceSource || body.source || 'segment', createdAt: new Date().toISOString(), totalRecipients: Number(body.totalRecipients || body.recipientIds?.length || 36), sentCount: 0, deliveredCount: 0, readCount: 0, failedCount: 0, pendingCount: Number(body.totalRecipients || body.recipientIds?.length || 36) }; state.campaigns.unshift(campaign); return sendJson(res, { campaign, id: campaign.id, demo: true }, 201); }
		if (pathname === '/campaigns/automation-runs') return sendJson(res, { runs: [], items: [], demo: true });
		if (pathname === '/campaigns/schedules') return sendJson(res, { schedules: [], items: [], demo: true });
		if (pathname === '/campaigns/abandoned-carts/preview' && method === 'POST') return sendJson(res, { total: state.carts.filter((item) => item.status === 'NEW').length, recipients: state.carts.filter((item) => item.status === 'NEW').map((item) => ({ id: item.id, name: item.contactName, phone: item.contactPhone, totalLabel: item.totalLabel })), demo: true });

		if (pathname.includes('/campaigns/abandoned-cart-automation/settings')) return sendJson(res, { settings: automationSettings(), ...automationSettings(), demo: true });
		if (pathname.includes('/campaigns/pending-payment-automation/settings')) return sendJson(res, { settings: automationSettings('template-demo-order'), ...automationSettings('template-demo-order'), demo: true });
		if (pathname.includes('/campaigns/shipment-notifications/settings')) return sendJson(res, { settings: automationSettings('template-demo-order'), ...automationSettings('template-demo-order'), demo: true });
		if (pathname === '/campaigns/shipment-notifications/candidates') return sendJson(res, { candidates: [], summary: { total: 0 }, demo: true });
		if (pathname.endsWith('/run-now') || pathname === '/campaigns/dispatch/tick') return sendJson(res, { ok: true, processed: 0, deliveredExternally: false, demo: true });

		const campaignMatch = pathname.match(/^\/campaigns\/([^/]+)(?:\/(launch|cancel|retry-failed))?$/);
		if (campaignMatch) {
			const campaign = state.campaigns.find((item) => item.id === campaignMatch[1]);
			if (!campaign) return sendJson(res, { error: 'Campaña demo no encontrada.' }, 404);
			if (method === 'GET') { const recipients = campaignRecipients(campaign); return sendJson(res, { campaign, recipients, pagination: { page: 1, pageSize: 500, total: campaign.totalRecipients }, analytics: campaign.analytics || {}, diagnostics: campaign.diagnostics || { demo: true }, demo: true }); }
			if (method === 'DELETE') { state.campaigns = state.campaigns.filter((item) => item.id !== campaign.id); return sendJson(res, { ok: true, demo: true }); }
			if (campaignMatch[2] === 'launch') { campaign.status = 'RUNNING'; campaign.startedAt = new Date().toISOString(); campaign.sentCount = Math.max(1, Math.round(campaign.totalRecipients * 0.72)); campaign.deliveredCount = Math.round(campaign.sentCount * 0.91); campaign.readCount = Math.round(campaign.deliveredCount * 0.68); campaign.pendingCount = Math.max(0, campaign.totalRecipients - campaign.sentCount); return sendJson(res, { campaign, ok: true, demo: true, deliveredExternally: false }); }
			if (campaignMatch[2] === 'cancel') { campaign.status = 'CANCELLED'; campaign.finishedAt = new Date().toISOString(); return sendJson(res, { campaign, ok: true, demo: true }); }
			if (campaignMatch[2] === 'retry-failed') { campaign.status = 'RUNNING'; campaign.failedCount = 0; return sendJson(res, { campaign, ok: true, demo: true, deliveredExternally: false }); }
		}

		if (pathname === '/admin/workspaces') return sendJson(res, { workspaces: [demoWorkspace], demo: true });
		if (pathname === `/admin/workspaces/${demoWorkspace.id}`) return sendJson(res, { workspace: demoWorkspace, demo: true });
		if (pathname === `/admin/workspaces/${demoWorkspace.id}/users`) return sendJson(res, { users: [demoUser], demo: true });
		if (pathname === `/admin/workspaces/${demoWorkspace.id}/catalog/status`) return sendJson(res, { catalog: { totalProducts: catalog.length, totalPublished: catalog.length, lastSync: { status: 'SUCCESS', finishedAt: DEMO_NOW } }, demo: true });
		if (pathname === '/admin/analytics/workspaces') return sendJson(res, {
			activityWindowDays: 30,
			totals: { campaignsCount: state.campaigns.length, activeCampaignsCount: state.campaigns.filter((item) => item.status === 'RUNNING').length, recipientsCount: 251, customersCount: 128, revenueTotal: 3205000, currency: 'ARS', activeConversations30d: 34, recoveredCartsCount: 9, recoveredCartValue: 721500, estimatedCampaignCostUsd: 12.4, sentRecipientsCount: 184, deliveredRecipientsCount: 172, readRecipientsCount: 125, failedRecipientsCount: 7, unreadMessagesCount: 6 },
			workspaces: [{ workspace: demoWorkspace, metrics: { messages30dInbound: 286, messages30dOutbound: 241, activeConversations30d: 34, sentRecipientsCount: 184, deliveredRecipientsCount: 172, readRecipientsCount: 125, failedRecipientsCount: 7, deliveryRate: 93.5, readRate: 72.7, conversionCount: 16, recoveredCartsCount: 9, recoveredCartValue: 721500, currency: 'ARS', estimatedCampaignCostUsd: 12.4, unreadMessagesCount: 6 } }],
			detail: {
				workspaceId: demoWorkspace.id,
				campaigns: state.campaigns.map((campaign) => ({ ...campaign, sentRecipients: campaign.sentCount, deliveredRecipients: campaign.deliveredCount, readRecipients: campaign.readCount, failedRecipients: campaign.failedCount })),
				customers: { ordersCount: 13, revenueTotal: 3205000, recentOrders: [], topCustomers: [] },
			},
			demo: true,
		});
		if (pathname === '/tiendanube/status' || pathname === '/shopify/status') return sendJson(res, { connected: false, configured: false, demo: true });
		if (pathname === '/whatsapp-menu' && method === 'GET') return sendJson(res, { settings: clone(state.menuSettings), demo: true });
		if (pathname === '/whatsapp-menu' && method === 'PUT') {
			const body = await readBody(req);
			state.menuSettings = { name: body.name || 'Menú de atención', config: clone(body.config || state.menuSettings.config) };
			return sendJson(res, { settings: clone(state.menuSettings), demo: true, deliveredExternally: false });
		}
		if (pathname === '/whatsapp-menu/reset' && method === 'POST') {
			state.menuSettings = createInitialState().menuSettings;
			return sendJson(res, { settings: clone(state.menuSettings), demo: true, deliveredExternally: false });
		}

		if (pathname === '/ai-lab/sessions' && method === 'POST') {
			state.aiSession = { id: 'ai-session-demo-local', fixtureKey: 'blank', messages: [], createdAt: new Date().toISOString(), demo: true };
			return sendJson(res, { ok: true, session: state.aiSession, demo: true, providerCalled: false }, 201);
		}
		if (pathname === '/ai-lab/sessions/ai-session-demo-local/reset' && method === 'POST') {
			state.aiSession = { id: 'ai-session-demo-local', fixtureKey: 'blank', messages: [], createdAt: new Date().toISOString(), demo: true };
			return sendJson(res, { ok: true, session: state.aiSession, demo: true, providerCalled: false });
		}
		if (pathname === '/ai-lab/sessions/ai-session-demo-local/messages' && method === 'POST') {
			const body = await readBody(req);
			const userText = String(body.body || body.selectionId || '').trim();
			const userMessage = { id: `ai-user-demo-${++state.sequence}`, role: 'user', type: 'text', text: userText, createdAt: new Date().toISOString() };
			const assistantMessage = { id: `ai-assistant-demo-${++state.sequence}`, role: 'assistant', type: 'text', text: `Respuesta sintética: recibí “${userText}”. En el modo demo no se consulta Gemini ni se envía contenido externo.`, provider: 'LOCAL_DEMO', model: 'deterministic-fixture', createdAt: new Date().toISOString() };
			state.aiSession.messages.push(userMessage, assistantMessage);
			return sendJson(res, { ok: true, session: state.aiSession, demo: true, providerCalled: false });
		}

		return sendJson(res, { ok: true, demo: true, deliveredExternally: false, note: `Endpoint simulado sin fixture específico: ${method} ${pathname}` });
	};
}

export function createDemoApiPlugin() {
	const stateRef = { current: createInitialState() };
	return {
		name: 'bladeia-local-demo-api',
		configureServer(server) {
			server.middlewares.use(makeHandler(stateRef));
			server.config.logger.info('Modo demo local activo: datos sintéticos, sin delivery externo.');
		},
	};
}
