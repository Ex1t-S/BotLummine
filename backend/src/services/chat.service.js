import { prisma } from '../lib/prisma.js';
import { runAssistantReply } from './ai/index.js';
import { sendWhatsAppText, sendWhatsAppInteractiveList } from './whatsapp.service.js';
import { normalizeThreadPhone } from '../lib/conversation-threads.js';
import {
	detectIntent,
	extractOrderNumber,
	extractStandaloneOrderNumber
} from '../lib/intent.js';
import {
	analyzeConversationTurn,
	buildHandoffReply
} from './conversation-analysis.service.js';
import {
	handleOrderStatusIntent,
	buildFixedOrderReply
} from './intents/order-status.service.js';
import { handlePaymentIntent } from './intents/payment.service.js';
import { handleShippingIntent } from './intents/shipping.service.js';
import { handleSizeHelpIntent } from './intents/size-help.service.js';
import { handleProductRecommendationIntent } from './intents/product-recommendation.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints
} from './catalog-search.service.js';
import { resolveCommercialBrainV2 } from './commercial-brain.service.js';
import {
	isPaymentProofMessage,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';

const MENU_IDS = {
	MAIN_PRODUCTS: 'menu_main_products',
	MAIN_ORDERS: 'menu_main_orders',
	MAIN_SUPPORT: 'menu_main_support',
	MAIN_HUMAN: 'menu_main_human',
	PRODUCTS_BODYS: 'menu_products_bodys',
	PRODUCTS_CALZAS: 'menu_products_calzas',
	PRODUCTS_CATALOG: 'menu_products_catalog',
	PRODUCTS_BACK: 'menu_products_back',
	ORDERS_STATUS: 'menu_orders_status',
	ORDERS_ISSUE: 'menu_orders_issue',
	ORDERS_PAYMENT_PROOF: 'menu_orders_payment_proof',
	ORDERS_BACK: 'menu_orders_back',
	SUPPORT_PAYMENTS: 'menu_support_payments',
	SUPPORT_SHIPPING: 'menu_support_shipping',
	SUPPORT_SIZES: 'menu_support_sizes',
	SUPPORT_HUMAN: 'menu_support_human',
	SUPPORT_BACK: 'menu_support_back'
};

const MENU_PATHS = {
	MAIN: 'MAIN_MENU',
	PRODUCTS: 'PRODUCTS_MENU',
	ORDERS: 'ORDERS_MENU',
	SUPPORT: 'SUPPORT_MENU'
};

function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeLooseText(value = '') {
	return normalizeText(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function summarizeText(value = '', max = 160) {
	const text = normalizeText(value);
	if (!text) return '';
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trim()}…`;
}

function uniqueStringArray(values = []) {
	return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map((value) => String(value)))];
}

function isGreetingOnlyMessage(messageBody = '') {
	const text = normalizeLooseText(messageBody);
	if (!text) return false;

	return /^(hola+|holaaa+|buenas+|buen dia|buen diaa+|buenas tardes|buenas noches|hello+|hi+|hey+|alo+|ey+)$/.test(text);
}

function isMenuResetCommand(messageBody = '') {
	const text = normalizeLooseText(messageBody);
	return [
		'menu',
		'menú',
		'inicio',
		'volver',
		'volver al menu',
		'volver al menú',
		'opciones',
		'0'
	].includes(text);
}

function getInteractiveReplyId(rawPayload = null) {
	const message = rawPayload?.message || {};
	return (
		message?.interactive?.list_reply?.id ||
		message?.interactive?.button_reply?.id ||
		message?.button?.payload ||
		null
	);
}

function getMenuConfig(menuPath = MENU_PATHS.MAIN) {
	const commonFooter = 'Escribí 0 o menú para volver al inicio.';

	if (menuPath === MENU_PATHS.PRODUCTS) {
		return {
			path: MENU_PATHS.PRODUCTS,
			headerText: 'Productos',
			body: 'Elegí qué querés ver:',
			buttonText: 'Productos',
			footerText: commonFooter,
			textFallback: [
				'🛍️ *Productos*',
				'1- Bodys modeladores',
				'2- Calzas linfáticas',
				'3- Ver catálogo general',
				'0- Volver al inicio'
			].join('\n'),
			sections: [
				{
					title: 'Productos',
					rows: [
						{ id: MENU_IDS.PRODUCTS_BODYS, title: 'Bodys modeladores', description: 'Ver opciones y promos' },
						{ id: MENU_IDS.PRODUCTS_CALZAS, title: 'Calzas linfáticas', description: 'Consultar modelos disponibles' },
						{ id: MENU_IDS.PRODUCTS_CATALOG, title: 'Catálogo general', description: 'Pedir catálogo o recomendación' },
						{ id: MENU_IDS.PRODUCTS_BACK, title: 'Volver al inicio', description: 'Ir al menú principal' }
					]
				}
			],
			aliases: {
				[MENU_IDS.PRODUCTS_BODYS]: ['1', 'body', 'bodys', 'body modelador', 'bodys modeladores', 'ver bodys'],
				[MENU_IDS.PRODUCTS_CALZAS]: ['2', 'calza', 'calzas', 'calzas linfaticas', 'calzas linfáticas'],
				[MENU_IDS.PRODUCTS_CATALOG]: ['3', 'catalogo', 'catálogo', 'catalogo general', 'ver catalogo', 'ver catálogo'],
				[MENU_IDS.PRODUCTS_BACK]: ['0', 'volver', 'inicio', 'menu', 'menú']
			}
		};
	}

	if (menuPath === MENU_PATHS.ORDERS) {
		return {
			path: MENU_PATHS.ORDERS,
			headerText: 'Pedidos',
			body: 'Elegí qué necesitás con tu pedido:',
			buttonText: 'Pedidos',
			footerText: commonFooter,
			textFallback: [
				'📦 *Pedidos*',
				'1- Ver estado de mi pedido',
				'2- Tengo un problema con mi pedido',
				'3- Enviar comprobante',
				'0- Volver al inicio'
			].join('\n'),
			sections: [
				{
					title: 'Pedidos',
					rows: [
						{ id: MENU_IDS.ORDERS_STATUS, title: 'Estado de mi pedido', description: 'Consultar seguimiento o estado' },
						{ id: MENU_IDS.ORDERS_ISSUE, title: 'Problema con mi pedido', description: 'Contar lo que pasó' },
						{ id: MENU_IDS.ORDERS_PAYMENT_PROOF, title: 'Enviar comprobante', description: 'Mandar foto o archivo' },
						{ id: MENU_IDS.ORDERS_BACK, title: 'Volver al inicio', description: 'Ir al menú principal' }
					]
				}
			],
			aliases: {
				[MENU_IDS.ORDERS_STATUS]: ['1', 'estado', 'estado pedido', 'ver pedido', 'seguimiento'],
				[MENU_IDS.ORDERS_ISSUE]: ['2', 'problema', 'reclamo', 'pedido mal', 'problema pedido'],
				[MENU_IDS.ORDERS_PAYMENT_PROOF]: ['3', 'comprobante', 'pago', 'enviar comprobante'],
				[MENU_IDS.ORDERS_BACK]: ['0', 'volver', 'inicio', 'menu', 'menú']
			}
		};
	}

	if (menuPath === MENU_PATHS.SUPPORT) {
		return {
			path: MENU_PATHS.SUPPORT,
			headerText: 'Ayuda rápida',
			body: 'Elegí la consulta que querés resolver:',
			buttonText: 'Ayuda',
			footerText: commonFooter,
			textFallback: [
				'💬 *Ayuda rápida*',
				'1- Medios de pago',
				'2- Envíos',
				'3- Talles',
				'4- Hablar con una asesora',
				'0- Volver al inicio'
			].join('\n'),
			sections: [
				{
					title: 'Ayuda',
					rows: [
						{ id: MENU_IDS.SUPPORT_PAYMENTS, title: 'Medios de pago', description: 'Ver formas de pago disponibles' },
						{ id: MENU_IDS.SUPPORT_SHIPPING, title: 'Envíos', description: 'Consultar zonas y tiempos' },
						{ id: MENU_IDS.SUPPORT_SIZES, title: 'Talles', description: 'Pedir ayuda con el talle' },
						{ id: MENU_IDS.SUPPORT_HUMAN, title: 'Hablar con una asesora', description: 'Pasar a atención humana' },
						{ id: MENU_IDS.SUPPORT_BACK, title: 'Volver al inicio', description: 'Ir al menú principal' }
					]
				}
			],
			aliases: {
				[MENU_IDS.SUPPORT_PAYMENTS]: ['1', 'pago', 'pagos', 'medios de pago'],
				[MENU_IDS.SUPPORT_SHIPPING]: ['2', 'envio', 'envíos', 'envioo', 'envíos', 'shipping'],
				[MENU_IDS.SUPPORT_SIZES]: ['3', 'talle', 'talles', 'size', 'sizes'],
				[MENU_IDS.SUPPORT_HUMAN]: ['4', 'asesora', 'asesor', 'humano', 'atencion humana', 'atención humana'],
				[MENU_IDS.SUPPORT_BACK]: ['0', 'volver', 'inicio', 'menu', 'menú']
			}
		};
	}

	return {
		path: MENU_PATHS.MAIN,
		headerText: 'Lummine',
		body: 'Elegí una opción para ayudarte más rápido:',
		buttonText: 'Abrir menú',
		footerText: commonFooter,
		textFallback: [
			'👋 *Bienvenida a Lummine*',
			'1- Ver productos',
			'2- Problemas o estado de pedido',
			'3- Pagos, envíos o talles',
			'4- Hablar con una asesora',
			'',
			'Respondé con el número de opción.'
		].join('\n'),
		sections: [
			{
				title: 'Menú principal',
				rows: [
					{ id: MENU_IDS.MAIN_PRODUCTS, title: 'Ver productos', description: 'Bodys, calzas y catálogo' },
					{ id: MENU_IDS.MAIN_ORDERS, title: 'Pedidos', description: 'Estado, problema o comprobante' },
					{ id: MENU_IDS.MAIN_SUPPORT, title: 'Pagos, envíos y talles', description: 'Resolver dudas rápidas' },
					{ id: MENU_IDS.MAIN_HUMAN, title: 'Hablar con una asesora', description: 'Pasar a atención humana' }
				]
			}
		],
		aliases: {
			[MENU_IDS.MAIN_PRODUCTS]: ['1', 'productos', 'ver productos', 'product', 'producto'],
			[MENU_IDS.MAIN_ORDERS]: ['2', 'pedido', 'pedidos', 'estado pedido', 'problema pedido', 'problemas con pedido'],
			[MENU_IDS.MAIN_SUPPORT]: ['3', 'pagos', 'envios', 'envíos', 'talles', 'ayuda'],
			[MENU_IDS.MAIN_HUMAN]: ['4', 'asesora', 'asesor', 'humano', 'persona', 'hablar con una asesora']
		}
	};
}

function detectMenuSelection({ messageBody, rawPayload, menuPath }) {
	const config = getMenuConfig(menuPath);
	const interactiveId = getInteractiveReplyId(rawPayload);

	if (interactiveId && config.aliases?.[interactiveId]) {
		return interactiveId;
	}

	const normalized = normalizeLooseText(messageBody);
	if (!normalized) return null;

	for (const [optionId, aliases] of Object.entries(config.aliases || {})) {
		if ((aliases || []).some((alias) => normalizeLooseText(alias) === normalized)) {
			return optionId;
		}
	}

	return null;
}

async function patchConversationState(conversationId, patch = {}) {
	const safePatch = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined)
	);

	return prisma.conversationState.upsert({
		where: { conversationId },
		update: safePatch,
		create: {
			conversationId,
			interactionCount: 0,
			interestedProducts: [],
			objections: [],
			...safePatch
		}
	});
}

function buildConversationSummary({
	intent,
	enrichedState,
	lastUserMessage,
	lastAssistantMessage,
	liveOrderContext,
	commercialPlan = null
}) {
	const parts = [];

	if (enrichedState?.lastUserGoal) {
		parts.push(`Objetivo: ${enrichedState.lastUserGoal}`);
	}

	if (enrichedState?.menuPath) {
		parts.push(`Menú: ${enrichedState.menuPath}`);
	}

	if (enrichedState?.menuLastSelection) {
		parts.push(`Selección: ${enrichedState.menuLastSelection}`);
	}

	if (enrichedState?.interestedProducts?.length) {
		parts.push(`Interés: ${enrichedState.interestedProducts.join(', ')}`);
	}

	if (commercialPlan?.productFocus) {
		parts.push(`Foco: ${commercialPlan.productFocus}`);
	}

	if (commercialPlan?.bestOffer?.name) {
		parts.push(`Oferta: ${commercialPlan.bestOffer.name}`);
	}

	if (enrichedState?.frequentSize) {
		parts.push(`Talle: ${enrichedState.frequentSize}`);
	}

	if (enrichedState?.paymentPreference) {
		parts.push(`Pago: ${enrichedState.paymentPreference}`);
	}

	if (enrichedState?.deliveryPreference) {
		parts.push(`Entrega: ${enrichedState.deliveryPreference}`);
	}

	if (intent === 'order_status' && liveOrderContext) {
		parts.push(`Pedido #${liveOrderContext.orderNumber}`);
		parts.push(`Pago ${liveOrderContext.paymentStatus}`);
		parts.push(`Envío ${liveOrderContext.shippingStatus}`);
		if (liveOrderContext.shippingCarrier) {
			parts.push(`Carrier ${liveOrderContext.shippingCarrier}`);
		}
	}

	if (enrichedState?.needsHuman || commercialPlan?.shouldEscalate) {
		parts.push(`Derivar: ${enrichedState.handoffReason || commercialPlan?.handoffReason || 'sí'}`);
	}

	if (lastUserMessage) {
		parts.push(`Último cliente: ${summarizeText(lastUserMessage, 120)}`);
	}

	if (lastAssistantMessage) {
		parts.push(`Última respuesta: ${summarizeText(lastAssistantMessage, 120)}`);
	}

	return parts.filter(Boolean).join(' | ');
}

function buildAiFailureFallback({
	intent,
	enrichedState,
	catalogProducts = [],
	commercialPlan = null
}) {
	const firstProduct =
		Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (intent === 'product') {
		if (commercialPlan?.recommendedAction === 'present_single_best_offer' && commercialPlan?.bestOffer) {
			return `${commercialPlan.bestOffer.name}${commercialPlan.bestOffer.price ? ` por ${commercialPlan.bestOffer.price}` : ''}.`;
		}

		if (commercialPlan?.recommendedAction === 'present_price_once' && commercialPlan?.bestOffer) {
			return `${commercialPlan.bestOffer.name} está ${commercialPlan.bestOffer.price}.`;
		}

		if (commercialPlan?.recommendedAction === 'confirm_variant_and_continue' && commercialPlan?.bestOffer) {
			return `Sí, lo trabajamos en esa opción. Si querés seguimos con ${commercialPlan.bestOffer.name}.`;
		}

		if (commercialPlan?.recommendedAction === 'close_with_single_link' && commercialPlan?.bestOffer?.productUrl) {
			return `Sí, te paso el link directo: ${commercialPlan.bestOffer.productUrl}`;
		}

		return firstProduct?.productUrl
			? `Te paso el link del producto: ${firstProduct.productUrl}`
			: 'Contame cuál producto te interesa y te oriento.';
	}

	if (intent === 'payment') {
		return 'Sí, aceptamos ese medio de pago. Si querés te indico cómo seguir.';
	}

	if (intent === 'shipping') {
		return 'Sí, hacemos envíos. Decime tu zona o ciudad y te digo cómo sería.';
	}

	if (intent === 'size_help') {
		return 'Decime qué talle usás normalmente y te oriento.';
	}

	if (intent === 'order_status') {
		return 'Pasame tu número de pedido y te reviso el estado por acá.';
	}

	return 'Te sigo ayudando por acá. Contame un poquito más así te respondo mejor.';
}

function buildResponsePolicy({
	intent,
	enrichedState,
	aiGuidance,
	liveOrderContext,
	queueDecision,
	commercialPlan
}) {
	if (
		queueDecision?.queue === 'HUMAN' ||
		enrichedState?.needsHuman ||
		commercialPlan?.shouldEscalate
	) {
		return {
			action: 'handoff_human',
			useAI: false,
			allowHandoffMention: true,
			maxChars: 220,
			tone: 'empatico_concreto'
		};
	}

	if (intent === 'order_status') {
		if (!liveOrderContext) {
			return {
				action: 'ask_order_number_or_not_found',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 220,
				tone: 'postventa_clara'
			};
		}

		if (liveOrderContext.trackingUrl || liveOrderContext.trackingNumber) {
			return {
				action: 'order_status_with_tracking',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 320,
				tone: 'postventa_clara'
			};
		}

		return {
			action: 'order_status_without_tracking',
			useAI: false,
			allowHandoffMention: false,
			maxChars: 320,
			tone: 'postventa_clara'
		};
	}

	if (intent === 'payment') {
		return {
			action: 'payment_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'shipping') {
		return {
			action: 'shipping_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'size_help') {
		return {
			action: 'size_help',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo'
		};
	}

	if (intent === 'product') {
		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_single_best_offer'
						? 180
						: 220,
			tone:
				commercialPlan?.mood === 'angry'
					? 'empatico_concreto'
					: 'guia_comercial_directa'
		};
	}

	return {
		action: 'general_help',
		useAI: true,
		allowHandoffMention: false,
		maxChars: 220,
		tone: enrichedState?.preferredTone || 'amigable_directo'
	};
}

function responseMentionsHumanHandoff(text = '') {
	return /(te paso con una asesora|te paso con un asesor|te derivo con una asesora|te derivo con un asesor|lo revisa una asesora|lo revisa un asesor|ya lo toma una persona|te contacta el equipo|atencion humana|atención humana)/i.test(
		String(text || '')
	);
}

function looksLikeInventedTracking(text = '', liveOrderContext = null) {
	const normalized = String(text || '').toLowerCase();

	if (
		!liveOrderContext?.trackingUrl &&
		/seguilo aca|seguirlo aca|pod[eé]s seguirlo acá|pod[eé]s seguirlo aca|link de seguimiento/i.test(normalized)
	) {
		return true;
	}

	if (!liveOrderContext?.trackingNumber && /c[oó]digo de seguimiento|seguimiento:/i.test(normalized)) {
		return true;
	}

	return false;
}

function auditAssistantReply({
	text,
	responsePolicy,
	liveOrderContext,
	fallbackReply,
	commercialPlan
}) {
	const cleaned = normalizeText(text);

	if (!cleaned) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	if (
		responsePolicy?.action?.startsWith('order_status') &&
		looksLikeInventedTracking(cleaned, liveOrderContext)
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	if (
		commercialPlan?.shareLinkNow === false &&
		commercialPlan?.alreadyShared?.sharedLinks?.some((link) => cleaned.includes(link))
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false
		};
	}

	const triggerHumanHandoff =
		commercialPlan?.shouldEscalate || responseMentionsHumanHandoff(cleaned);

	return {
		finalText: cleaned,
		triggerHumanHandoff
	};
}

async function syncHumanHandoff({ conversationId, reason = 'ai_declared_handoff' }) {
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			queue: 'HUMAN',
			aiEnabled: false,
			lastMessageAt: new Date()
		}
	});

	await patchConversationState(conversationId, {
		needsHuman: true,
		handoffReason: reason,
		menuActive: false,
		menuPath: null
	});
}

async function sendMenuPrompt({ conversationId, waId, menuPath, bodyPrefix = '' }) {
	const menuConfig = getMenuConfig(menuPath);
	const body = [bodyPrefix ? normalizeText(bodyPrefix) : null, menuConfig.body]
		.filter(Boolean)
		.join('\n\n');

	return sendAndPersistOutbound({
		conversationId,
		body: body || menuConfig.body,
		messageType: 'interactive',
		interactivePayload: {
			headerText: menuConfig.headerText,
			footerText: menuConfig.footerText,
			buttonText: menuConfig.buttonText,
			sections: menuConfig.sections,
			fallbackText: menuConfig.textFallback
		},
		aiMeta: {
			provider: 'system',
			model: `menu-${menuConfig.path.toLowerCase()}`,
			raw: { menuPath: menuConfig.path }
		}
	});
}

async function sendMenuTextOnly({ conversationId, body, model = 'menu-text' }) {
	return sendAndPersistOutbound({
		conversationId,
		body,
		aiMeta: {
			provider: 'system',
			model,
			raw: { kind: 'menu_text' }
		}
	});
}

function shouldForceMenuFirst({ currentState, freshConversation, messageBody }) {
	if (isMenuResetCommand(messageBody)) return true;
	if (currentState?.needsHuman) return false;
	if (currentState?.menuActive && currentState?.menuPath) return true;

	// Si saluda, abrimos menú aunque ya exista historial
	if (isGreetingOnlyMessage(messageBody)) return true;

	const inboundCount = (freshConversation?.messages || []).filter((msg) => msg.direction === 'INBOUND').length;
	const outboundCount = (freshConversation?.messages || []).filter((msg) => msg.direction === 'OUTBOUND').length;
	const hasNoMeaningfulHistory = !currentState?.lastIntent && (currentState?.interactionCount || 0) === 0;

	return inboundCount === 1 && outboundCount === 0 && hasNoMeaningfulHistory;
}

async function handleMenuSelection({
	selectionId,
	conversation,
	currentState,
	contactName,
	waId
}) {
	const conversationId = conversation.id;

	if (selectionId === MENU_IDS.MAIN_PRODUCTS) {
		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: MENU_PATHS.PRODUCTS,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId,
			waId,
			menuPath: MENU_PATHS.PRODUCTS,
			bodyPrefix: 'Perfecto. Vamos por productos.'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.MAIN_ORDERS) {
		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: MENU_PATHS.ORDERS,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId,
			waId,
			menuPath: MENU_PATHS.ORDERS,
			bodyPrefix: 'Dale. Veamos tu pedido.'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.MAIN_SUPPORT) {
		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: MENU_PATHS.SUPPORT,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId,
			waId,
			menuPath: MENU_PATHS.SUPPORT,
			bodyPrefix: 'Buenísimo. Te dejo ayuda rápida.'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.MAIN_HUMAN || selectionId === MENU_IDS.SUPPORT_HUMAN) {
		await syncHumanHandoff({
			conversationId,
			reason: 'menu_requested_human'
		});

		const handoffReply = buildHandoffReply({
			contactName: contactName || '',
			reason: 'menu_requested_human'
		});

		await sendMenuTextOnly({
			conversationId,
			body: handoffReply,
			model: 'menu-human-handoff'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.PRODUCTS_BACK || selectionId === MENU_IDS.ORDERS_BACK || selectionId === MENU_IDS.SUPPORT_BACK) {
		await patchConversationState(conversationId, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastSelection: selectionId,
			menuLastPromptAt: new Date()
		});

		await sendMenuPrompt({
			conversationId,
			waId,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: 'Volvimos al inicio.'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.PRODUCTS_BODYS) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			currentProductFocus: 'bodys modeladores'
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero ver bodys modeladores',
			summaryUserMessage: 'Cliente eligió menú: bodys modeladores',
			forceIntent: 'product',
			statePatch: {
				menuLastSelection: selectionId,
				currentProductFocus: 'bodys modeladores',
				interestedProducts: uniqueStringArray([
					...(Array.isArray(currentState?.interestedProducts) ? currentState.interestedProducts : []),
					'bodys modeladores'
				])
			}
		};
	}

	if (selectionId === MENU_IDS.PRODUCTS_CALZAS) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			currentProductFocus: 'calzas linfáticas'
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero ver calzas linfáticas',
			summaryUserMessage: 'Cliente eligió menú: calzas linfáticas',
			forceIntent: 'product',
			statePatch: {
				menuLastSelection: selectionId,
				currentProductFocus: 'calzas linfáticas',
				interestedProducts: uniqueStringArray([
					...(Array.isArray(currentState?.interestedProducts) ? currentState.interestedProducts : []),
					'calzas linfáticas'
				])
			}
		};
	}

	if (selectionId === MENU_IDS.PRODUCTS_CATALOG) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero ver el catálogo general y recibir una recomendación',
			summaryUserMessage: 'Cliente eligió menú: catálogo general',
			forceIntent: 'product',
			statePatch: { menuLastSelection: selectionId }
		};
	}

	if (selectionId === MENU_IDS.ORDERS_STATUS) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero saber el estado de mi pedido',
			summaryUserMessage: 'Cliente eligió menú: estado de pedido',
			forceIntent: 'order_status',
			statePatch: { menuLastSelection: selectionId }
		};
	}

	if (selectionId === MENU_IDS.ORDERS_ISSUE) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			lastUserGoal: 'Resolver un problema con su pedido'
		});

		await sendMenuTextOnly({
			conversationId,
			body: 'Contame qué pasó con tu pedido y, si lo tenés, pasame también el número de pedido así lo reviso mejor.',
			model: 'menu-order-issue'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.ORDERS_PAYMENT_PROOF) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId,
			lastUserGoal: 'Enviar comprobante de pago'
		});

		await sendMenuTextOnly({
			conversationId,
			body: 'Mandame el comprobante por acá en foto o archivo y lo revisamos.',
			model: 'menu-payment-proof'
		});

		return { handled: true };
	}

	if (selectionId === MENU_IDS.SUPPORT_PAYMENTS) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero saber qué medios de pago aceptan',
			summaryUserMessage: 'Cliente eligió menú: medios de pago',
			forceIntent: 'payment',
			statePatch: { menuLastSelection: selectionId }
		};
	}

	if (selectionId === MENU_IDS.SUPPORT_SHIPPING) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId
		});

		return {
			handled: false,
			effectiveMessageBody: 'Quiero consultar sobre envíos',
			summaryUserMessage: 'Cliente eligió menú: envíos',
			forceIntent: 'shipping',
			statePatch: { menuLastSelection: selectionId }
		};
	}

	if (selectionId === MENU_IDS.SUPPORT_SIZES) {
		await patchConversationState(conversationId, {
			menuActive: false,
			menuPath: null,
			menuLastSelection: selectionId
		});

		return {
			handled: false,
			effectiveMessageBody: 'Necesito ayuda con los talles',
			summaryUserMessage: 'Cliente eligió menú: talles',
			forceIntent: 'size_help',
			statePatch: { menuLastSelection: selectionId }
		};
	}

	return { handled: false };
}

async function maybeHandleMenuFlow({
	conversation,
	currentState,
	contactName,
	messageBody,
	messageType,
	rawPayload
}) {
	const waId = conversation.contact?.waId || '';
	const wantsMenu = isMenuResetCommand(messageBody);
	const menuPath = currentState?.menuPath || MENU_PATHS.MAIN;
	const shouldOfferMenu = shouldForceMenuFirst({
		currentState,
		freshConversation: conversation,
		messageBody
	});

	if (!currentState?.needsHuman && shouldOfferMenu) {
		const selectionId = detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				waId
			});
		}

		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId
		});

		await sendMenuPrompt({
			conversationId: conversation.id,
			waId,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: isGreetingOnlyMessage(messageBody)
				? '¡Hola!'
				: 'Antes de seguir, te dejo el menú para ayudarte más rápido.'
		});

		return { handled: true };
	}

	if (wantsMenu) {
		await patchConversationState(conversation.id, {
			menuActive: true,
			menuPath: MENU_PATHS.MAIN,
			menuLastPromptAt: new Date(),
			customerName: contactName || currentState.customerName || waId,
			needsHuman: false,
			handoffReason: null
		});

		await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'AUTO',
				aiEnabled: true,
				lastMessageAt: new Date()
			}
		});

		await sendMenuPrompt({
			conversationId: conversation.id,
			waId,
			menuPath: MENU_PATHS.MAIN,
			bodyPrefix: 'Perfecto, abrimos el menú de nuevo.'
		});

		return { handled: true };
	}

	if (!currentState?.needsHuman && currentState?.menuActive && currentState?.menuPath) {
		const selectionId = detectMenuSelection({
			messageBody,
			rawPayload,
			menuPath: currentState.menuPath
		});

		if (selectionId) {
			return handleMenuSelection({
				selectionId,
				conversation,
				currentState,
				contactName,
				waId
			});
		}

		if (messageType === 'text' && normalizeText(messageBody)) {
			await patchConversationState(conversation.id, {
				menuLastPromptAt: new Date()
			});

			await sendMenuPrompt({
				conversationId: conversation.id,
				waId,
				menuPath: currentState.menuPath,
				bodyPrefix: 'No llegué a entender esa opción. Elegí una de la lista así vamos más rápido.'
			});

			return { handled: true };
		}
	}

	return {
		handled: false,
		effectiveMessageBody: messageBody,
		summaryUserMessage: messageBody,
		forceIntent: null,
		statePatch: null
	};
}

export async function getOrCreateConversation({
	waId,
	contactName,
	queue = 'AUTO',
	aiEnabled = true
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const contact = await prisma.contact.upsert({
		where: { waId: normalizedWaId },
		update: {
			name: contactName || undefined,
			phone: normalizedWaId
		},
		create: {
			waId: normalizedWaId,
			phone: normalizedWaId,
			name: contactName || normalizedWaId
		}
	});

	let conversation = await prisma.conversation.findFirst({
		where: { contactId: contact.id },
		include: { contact: true, state: true }
	});

	if (!conversation) {
		conversation = await prisma.conversation.create({
			data: {
				contactId: contact.id,
				queue,
				aiEnabled,
				lastMessageAt: new Date(),
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN',
						menuActive: true,
						menuPath: MENU_PATHS.MAIN
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (!conversation.state) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				state: {
					create: {
						customerName: contactName || normalizedWaId,
						interactionCount: 0,
						interestedProducts: [],
						objections: [],
						needsHuman: queue === 'HUMAN',
						menuActive: true,
						menuPath: MENU_PATHS.MAIN
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (conversation.queue !== queue || conversation.aiEnabled !== aiEnabled) {
		conversation = await prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue,
				aiEnabled
			},
			include: { contact: true, state: true }
		});
	}

	return conversation;
}

export async function sendAndPersistOutbound({
	conversationId,
	body,
	userId = null,
	provider = 'whatsapp-cloud-api',
	model = null,
	replyMessageId = null,
	aiMeta = null,
	messageType = 'text',
	interactivePayload = null,
}) {
	const cleanBody = String(body || '').trim();

	if (!conversationId) {
		throw new Error('Falta conversationId para enviar el mensaje.');
	}

	if (!cleanBody) {
		throw new Error('El mensaje no puede estar vacío.');
	}

	const conversation = await prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
		},
	});

	if (!conversation) {
		throw new Error('Conversación no encontrada.');
	}

	const waId = conversation.contact?.waId;

	console.log('[OUTBOUND DEBUG] sendAndPersistOutbound', {
		conversationId,
		waId,
		contactName: conversation.contact?.name || null,
		messageType,
		bodyPreview: cleanBody.slice(0, 160),
		replyMessageId,
	});

	if (!waId) {
		throw new Error('La conversación no tiene un waId válido para enviar el mensaje.');
	}

	let sendResult = null;

	if (messageType === 'interactive') {
		sendResult = await sendWhatsAppInteractiveList({
			to: waId,
			body: cleanBody,
			headerText: interactivePayload?.headerText || null,
			footerText: interactivePayload?.footerText || null,
			buttonText: interactivePayload?.buttonText || 'Ver opciones',
			sections: interactivePayload?.sections || []
		});

		if (!sendResult?.ok && interactivePayload?.fallbackText) {
			sendResult = await sendWhatsAppText({
				to: waId,
				body: interactivePayload.fallbackText
			});
		}
	} else {
		sendResult = await sendWhatsAppText({
			to: waId,
			body: cleanBody,
		});
	}

	console.log('[OUTBOUND DEBUG] send result', sendResult);

	if (!sendResult?.ok) {
		throw new Error(
			sendResult?.error?.message ||
			'No se pudo enviar el mensaje por WhatsApp.'
		);
	}

	const createdMessage = await prisma.message.create({
		data: {
			conversationId: conversation.id,
			direction: 'OUTBOUND',
			type: messageType,
			body: messageType === 'interactive' && interactivePayload?.fallbackText
				? interactivePayload.fallbackText
				: cleanBody,
			senderName: process.env.BUSINESS_NAME || 'Lummine',
			provider: aiMeta?.provider || provider,
			model: aiMeta?.model || model,
			metaMessageId:
				sendResult?.rawPayload?.messages?.[0]?.id ||
				replyMessageId ||
				null,
			rawPayload: aiMeta
				? {
					sendResult: sendResult?.rawPayload || null,
					aiMeta: aiMeta?.raw || null,
					userId,
					messageType,
				}
				: sendResult?.rawPayload || null,
		},
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: {
			lastMessageAt: createdMessage.createdAt,
		},
	});

	return {
		ok: true,
		message: createdMessage,
		sendResult,
	};
}

async function resolveIntentAction({ intent, messageBody, explicitOrderNumber, currentState }) {
	if (intent === 'order_status') {
		return handleOrderStatusIntent({ explicitOrderNumber, currentState });
	}

	if (intent === 'payment') {
		return handlePaymentIntent({ currentState });
	}

	if (intent === 'shipping') {
		return handleShippingIntent();
	}

	if (intent === 'size_help') {
		return handleSizeHelpIntent({ currentState });
	}

	if (intent === 'product') {
		return handleProductRecommendationIntent({ messageBody, currentState });
	}

	return {
		handled: false,
		forcedReply: null,
		liveOrderContext: null,
		aiGuidance: null
	};
}

function buildStatePayload({
	freshConversation,
	currentState,
	contactName,
	normalizedWaId,
	intent,
	explicitOrderNumber,
	liveOrderContext,
	memoryPatch,
	menuStatePatch = null
}) {
	const shouldKeepOrderContext =
		intent === 'order_status' ||
		(currentState?.lastIntent === 'order_status' && explicitOrderNumber);

	const interestedProducts = uniqueStringArray([
		...(Array.isArray(memoryPatch.interestedProducts) ? memoryPatch.interestedProducts : []),
		...(Array.isArray(menuStatePatch?.interestedProducts) ? menuStatePatch.interestedProducts : [])
	]);

	return {
		customerName: contactName || freshConversation.contact.name || normalizedWaId,
		lastIntent: shouldKeepOrderContext ? 'order_status' : intent,
		lastDetectedIntent: memoryPatch.lastDetectedIntent,
		lastUserGoal: menuStatePatch?.lastUserGoal || memoryPatch.lastUserGoal,
		lastOrderNumber: shouldKeepOrderContext
			? explicitOrderNumber || currentState.lastOrderNumber || null
			: null,
		lastOrderId: shouldKeepOrderContext
			? liveOrderContext?.orderId
				? String(liveOrderContext.orderId)
				: currentState.lastOrderId || null
			: null,
		preferredTone: memoryPatch.preferredTone,
		customerMood: memoryPatch.customerMood,
		urgencyLevel: memoryPatch.urgencyLevel,
		frequentSize: memoryPatch.frequentSize,
		paymentPreference: memoryPatch.paymentPreference,
		deliveryPreference: memoryPatch.deliveryPreference,
		interestedProducts,
		objections: memoryPatch.objections,
		needsHuman: memoryPatch.needsHuman,
		handoffReason: memoryPatch.handoffReason,
		interactionCount: memoryPatch.interactionCount,
		currentProductFocus: menuStatePatch?.currentProductFocus || currentState?.currentProductFocus || null,
		menuActive: false,
		menuPath: null,
		menuLastSelection: menuStatePatch?.menuLastSelection || currentState?.menuLastSelection || null,
		menuLastPromptAt: currentState?.menuLastPromptAt || null
	};
}

export async function processInboundMessage({
	waId,
	contactName,
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload,
	metaMessageId = null
}) {
	const normalizedWaId = normalizeThreadPhone(waId);

	const conversation = await getOrCreateConversation({
		waId: normalizedWaId,
		contactName
	});

	if (metaMessageId) {
		const existingMessage = await prisma.message.findUnique({
			where: { metaMessageId }
		});

		if (existingMessage) {
			return { conversation };
		}
	}

	await prisma.message.create({
		data: {
			conversationId: conversation.id,
			metaMessageId,
			senderName: contactName || normalizedWaId,
			direction: 'INBOUND',
			type: messageType || 'text',
			body: messageBody,
			attachmentUrl: attachmentMeta?.attachmentUrl || null,
			attachmentMimeType: attachmentMeta?.attachmentMimeType || null,
			attachmentName: attachmentMeta?.attachmentName || null,
			rawPayload
		}
	});

	await prisma.conversation.update({
		where: { id: conversation.id },
		data: { lastMessageAt: new Date() }
	});

	const freshConversation = await prisma.conversation.findUnique({
		where: { id: conversation.id },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' }
			}
		}
	});

	if (!freshConversation) {
		return { conversation };
	}

	const currentState = freshConversation.state || {};

	const menuDecision = await maybeHandleMenuFlow({
		conversation: freshConversation,
		currentState,
		contactName,
		messageBody,
		messageType,
		rawPayload
	});

	if (menuDecision?.handled) {
		return { conversation: freshConversation };
	}

	const effectiveMessageBody = normalizeText(menuDecision?.effectiveMessageBody || messageBody);
	const summaryUserMessage = normalizeText(menuDecision?.summaryUserMessage || effectiveMessageBody || messageBody);
	const forceIntent = menuDecision?.forceIntent || null;
	const menuStatePatch = menuDecision?.statePatch || null;

	const intent = forceIntent || detectIntent(effectiveMessageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(effectiveMessageBody, currentState) || extractStandaloneOrderNumber(effectiveMessageBody);

	const recentMessages = freshConversation.messages.slice(-8).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

	if (recentMessages.length) {
		recentMessages[recentMessages.length - 1] = {
			...recentMessages[recentMessages.length - 1],
			text: summaryUserMessage
		};
	}

	const memoryPatch = analyzeConversationTurn({
		messageBody: effectiveMessageBody,
		intent,
		currentState,
		recentMessages
	});

	if (intent === 'human_handoff') {
		memoryPatch.needsHuman = true;
		memoryPatch.handoffReason = 'requested_human';
	}

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: effectiveMessageBody,
		rawPayload,
		currentState,
		recentMessages
	});

	const queueDecision = resolveConversationQueue({
		currentConversation: freshConversation,
		memoryPatch,
		detectedPaymentProof,
		aiDeclaredHandoff: false
	});

	const intentResult = await resolveIntentAction({
		intent,
		messageBody: effectiveMessageBody,
		explicitOrderNumber,
		currentState
	});

	const aiGuidance = intentResult.aiGuidance || null;
	const liveOrderContext = intentResult.liveOrderContext || null;
	const forcedReply = intentResult.forcedReply || null;

	const nextStatePayload = buildStatePayload({
		freshConversation,
		currentState,
		contactName,
		normalizedWaId,
		intent,
		explicitOrderNumber,
		liveOrderContext,
		memoryPatch,
		menuStatePatch
	});

	await prisma.conversationState.upsert({
		where: { conversationId: freshConversation.id },
		update: nextStatePayload,
		create: {
			conversationId: freshConversation.id,
			...nextStatePayload
		}
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			queue: queueDecision.queue,
			aiEnabled: queueDecision.aiEnabled,
			lastMessageAt: new Date()
		}
	});

	const enrichedState = {
		...currentState,
		...nextStatePayload
	};

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: ack,
			aiMeta: {
				provider: 'system',
				model: 'payment-proof-router',
				raw: { detectedPaymentProof: true }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: ack,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation };
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = buildHandoffReply({
			contactName: freshConversation.contact.name || '',
			reason: enrichedState.handoffReason
		});

		await sendAndPersistOutbound({
			conversationId: freshConversation.id,
			body: handoffReply,
			aiMeta: {
				provider: 'system',
				model: 'human-handoff-router',
				raw: { handoffReason: enrichedState.handoffReason }
			}
		});

		await prisma.conversation.update({
			where: { id: freshConversation.id },
			data: {
				lastSummary: buildConversationSummary({
					intent,
					enrichedState,
					lastUserMessage: summaryUserMessage,
					lastAssistantMessage: handoffReply,
					liveOrderContext
				})
			}
		});

		return { conversation: freshConversation };
	}

	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

	const shouldReply =
		isAiEnabledGlobal &&
		queueDecision.aiEnabled &&
		queueDecision.queue === 'AUTO';
	console.log('[AI DEBUG] isAiEnabledGlobal:', isAiEnabledGlobal);
	console.log('[AI DEBUG] queueDecision:', queueDecision);
	console.log('[AI DEBUG] shouldReply:', shouldReply);
	console.log('[AI DEBUG] intent:', intent);
	console.log('[AI DEBUG] waId:', freshConversation.contact.waId);
	if (!shouldReply) {
		return { conversation: freshConversation };
	}

	const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);

	const fullRecentMessages = freshConversation.messages.slice(-maxContext).map((msg) => ({
		role: msg.direction === 'INBOUND' ? 'user' : 'assistant',
		text: msg.body
	}));

	if (fullRecentMessages.length) {
		fullRecentMessages[fullRecentMessages.length - 1] = {
			...fullRecentMessages[fullRecentMessages.length - 1],
			text: summaryUserMessage
		};
	}

	let catalogProducts = [];
	let catalogContext = '';
	let commercialHints = [];
	let commercialPlan = null;

	try {
		catalogProducts = await searchCatalogProducts({
			query: effectiveMessageBody,
			interestedProducts: enrichedState.interestedProducts || [],
			limit: 5
		});

		commercialPlan = resolveCommercialBrainV2({
			intent,
			messageBody: effectiveMessageBody,
			currentState: enrichedState,
			recentMessages: fullRecentMessages,
			catalogProducts
		});

		catalogProducts = commercialPlan?.rankedProducts?.length
			? commercialPlan.rankedProducts.slice(0, 5)
			: catalogProducts;

		if (commercialPlan?.greetingOnly) {
			catalogProducts = [];
			catalogContext = '';
			commercialHints = [
				'Es solo un saludo inicial.',
				'No ofrezcas productos ni promos todavía.',
				'Respondé breve y natural, invitando a contar qué está buscando.'
			];
		} else {
			catalogContext = buildCatalogContext(catalogProducts);
			commercialHints = pickCommercialHints(catalogProducts, commercialPlan);
		}

		if (aiGuidance?.type === 'payment') {
			if (Array.isArray(aiGuidance.missing) && aiGuidance.missing.length) {
				commercialHints.push(
					`Si pregunta por pago, pedí natural solo lo que falte (${aiGuidance.missing.join(', ')}).`
				);
			}

			if (aiGuidance.paymentDataAvailable) {
				commercialHints.push('Si realmente quiere avanzar, orientala sin abrir otra promo.');
			}
		}

		if (aiGuidance?.type === 'shipping') {
			commercialHints.push(
				'Si falta ubicación, pedí zona, localidad o provincia sin cortar el hilo.'
			);
		}

		if (aiGuidance?.type === 'size_help') {
			commercialHints.push(
				'Si ya venían hablando de un producto, tratá la pregunta de talle como continuidad.'
			);

			if (aiGuidance.knownSize) {
				commercialHints.push(
					`Ya hay un talle detectado en la conversación (${aiGuidance.knownSize}).`
				);
			}
		}

		commercialHints.push('No repitas saludo si la conversación ya empezó.');
		commercialHints.push('No derivas por una duda simple si ya la podés resolver.');
		commercialHints.push('Si la clienta ya dejó claro el producto, respondé directo.');
		commercialHints.push('No pases más de un link en una misma respuesta.');
		commercialHints.push('No abras varias promos si la clienta ya eligió una.');
		commercialHints.push('Bajá el tono celebratorio y soná más natural.');
	} catch (catalogError) {
		console.error('Error buscando productos en catálogo local:', catalogError);
	}

	const responsePolicy = buildResponsePolicy({
		intent,
		enrichedState,
		aiGuidance,
		liveOrderContext,
		queueDecision,
		commercialPlan
	});

	let finalReply = forcedReply || null;
	let aiMeta = null;

	if (!finalReply && !responsePolicy.useAI) {
		if (intent === 'order_status' && liveOrderContext) {
			finalReply = buildFixedOrderReply(liveOrderContext);
		} else {
			finalReply = buildAiFailureFallback({
				intent,
				enrichedState,
				catalogProducts,
				commercialPlan
			});
		}
	}

	if (!finalReply) {
		try {
			const aiResult = await runAssistantReply({
				businessName: process.env.BUSINESS_NAME || 'Lummine',
				contactName: freshConversation.contact.name || freshConversation.contact.waId,
				recentMessages: fullRecentMessages,
				conversationSummary: freshConversation.lastSummary || '',
				customerContext: {
					name: freshConversation.contact.name || freshConversation.contact.waId,
					waId: freshConversation.contact.waId
				},
				conversationState: enrichedState,
				liveOrderContext,
				catalogProducts,
				catalogContext,
				commercialHints,
				commercialPlan,
				responsePolicy
			});

			const fallbackReply =
				intent === 'order_status' && liveOrderContext
					? buildFixedOrderReply(liveOrderContext)
					: buildAiFailureFallback({
							intent,
							enrichedState,
							catalogProducts,
							commercialPlan
						});

			const audited = auditAssistantReply({
				text: aiResult?.text || '',
				responsePolicy,
				liveOrderContext,
				fallbackReply,
				commercialPlan
			});

			finalReply = audited.finalText;
			aiMeta = aiResult;

			if (audited.triggerHumanHandoff) {
				await syncHumanHandoff({
					conversationId: freshConversation.id,
					reason: commercialPlan?.handoffReason || 'ai_declared_handoff'
				});
			}
		} catch (aiError) {
			console.error('Error en flujo de respuesta automática:', aiError);

			finalReply =
				intent === 'order_status' && liveOrderContext
					? buildFixedOrderReply(liveOrderContext)
					: buildAiFailureFallback({
							intent,
							enrichedState,
							catalogProducts,
							commercialPlan
						});

			aiMeta = {
				provider: 'fallback',
				model: 'rule-based-fallback',
				raw: {
					error: aiError?.message || String(aiError)
				}
			};
		}
	}

	await sendAndPersistOutbound({
		conversationId: freshConversation.id,
		body: finalReply,
		aiMeta
	});

	await prisma.conversation.update({
		where: { id: freshConversation.id },
		data: {
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: summaryUserMessage,
				lastAssistantMessage: finalReply,
				liveOrderContext,
				commercialPlan
			})
		}
	});

	return { conversation: freshConversation };
}
