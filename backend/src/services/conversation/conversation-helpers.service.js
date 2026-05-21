import {
	handleOrderStatusIntent,
	buildFixedOrderReply,
} from '../intents/order-status.service.js';
import { STORE_LINKS } from '../../data/store-business.js';
import { handlePaymentIntent } from '../intents/payment.service.js';
import { handleShippingIntent } from '../intents/shipping.service.js';
import { handleSizeHelpIntent } from '../intents/size-help.service.js';
import { handleProductRecommendationIntent } from '../intents/product-recommendation.service.js';
import {
	looksLikeCancellationRequest as looksLikeCancellationRequestSignal,
	looksLikeCustomerFrustration,
	looksLikeExplicitHumanRequest,
	looksLikeRapidContinuation as looksLikeRapidContinuationSignal,
	looksLikeReturnOrWrongItemRequest as looksLikeReturnOrWrongItemRequestSignal,
	looksLikeSensitiveSupport as looksLikeSensitiveSupportSignal,
	looksLikeSimpleClosing,
	shouldTreatAsPreSaleObjection,
} from './conversation-signals.service.js';

const DKV_WORKSPACE_IDS = new Set(['cmpevb0oq0000pd0pgp66xq6k']);
const UNABLE_TO_CONTINUE_HANDOFF_REPLY =
	'Dejanos tu consulta detallada y, cuando un asesor este disponible, te va a contestar la duda.';

export function isDkvWorkspace(workspaceId = '') {
	return DKV_WORKSPACE_IDS.has(String(workspaceId || '').trim());
}

export function buildUnableToContinueHandoffReply() {
	return UNABLE_TO_CONTINUE_HANDOFF_REPLY;
}

export function isUnableToContinueHandoffReply(text = '') {
	return normalizeText(text).toLowerCase() === UNABLE_TO_CONTINUE_HANDOFF_REPLY.toLowerCase();
}

function looksLikeDkvOfficeRequest(messageBody = '') {
	const q = normalizeText(messageBody)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return /\b(cita|oficina|direccion|direccion|horario|telefono|whatsapp|vecindario|silva|atencion presencial|donde estan)\b/.test(q);
}

function looksLikeDkvSensitiveRequest(messageBody = '') {
	const q = normalizeText(messageBody)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return /\b(ya soy cliente|soy cliente|mi poliza|autorizacion|reembolso|recibo|certificado|duplicado|tarjeta sanitaria|cuadro medico|incidencia|datos personales)\b/.test(q);
}

function looksLikeDkvCatalogRequest(messageBody = '') {
	const q = normalizeText(messageBody)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	return (
		!looksLikeDkvSensitiveRequest(messageBody) &&
		/\b(catalogo|servicios|opciones|que seguros|seguros tienen|que polizas|polizas tienen|polizas ofrecen|seguros ofrecen)\b/.test(q)
	);
}

function buildDkvCatalogReply() {
	return [
		'En DKV Vecindario podemos orientarte sobre estos seguros:',
		'Salud particular: DKV Integral y DKV Personal Doctor.',
		'Empresas y autonomos: DKV Sanify Empresas, DKV Pymes, DKV Autonomos y DKV Gran Empresa.',
		'Complementarios: DKV Dental, Decesos, Hogar, Vida y Renta.',
		'Para recomendarte bien, dime si lo buscas para ti/familia, autonomo o empresa.'
	].join('\n');
}

function buildDkvOfficeReply() {
	return [
		'La oficina DKV Vecindario esta en C. Silva, 5, 35110 Vecindario, Las Palmas.',
		'Horario: lunes a viernes de 09:00 a 14:00. Tardes con cita previa.',
		'Telefono oficina: 928 79 08 40. WhatsApp comercial: 617086415. Atencion cliente DKV: 960160602.'
	].join('\n');
}

export function normalizeText(value = '') {
	return String(value || '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function summarizeText(value = '', max = 160) {
	const text = normalizeText(value);
	if (!text) return '';
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trim()}…`;
}

function buildGeneralCatalogReply() {
	if (STORE_LINKS.catalog) {
		return `Te paso el catálogo general para que veas todo: ${STORE_LINKS.catalog} Decime qué producto o promo puntual necesitás y te ayudo por acá.`;
	}

	return 'Puedo ayudarte por acá con productos, stock, talles, pagos o envíos. Decime qué estás buscando y lo revisamos.';
}

function buildCatalogOptionsReply(catalogProducts = []) {
	const names = Array.isArray(catalogProducts)
		? catalogProducts.map((product) => product?.name).filter(Boolean)
		: [];

	if (!names.length) return buildGeneralCatalogReply();

	const preferredOrder = [
		'DKV Integral',
		'DKV Personal Doctor',
		'DKV Sanify Empresas',
		'DKV Pymes',
		'DKV Autonomos',
		'DKV Gran Empresa',
		'DKV Dental',
		'DKV Decesos',
		'DKV Hogar',
		'DKV Vida',
		'DKV Renta',
	];
	const cleanNames = names.filter((name) => !/^catalogo de seguros/i.test(name) && !/^gestiones de clientes/i.test(name));
	const ordered = [
		...preferredOrder.filter((name) => cleanNames.includes(name)),
		...cleanNames.filter((name) => !preferredOrder.includes(name)),
	];
	const visible = (ordered.length ? ordered : names).slice(0, 6);
	const suffix = names.length > visible.length ? ' y otras opciones' : '';
	return `Tenemos estas opciones: ${visible.join(', ')}${suffix}. Decime si es para particular, autonomo o empresa y te oriento con la alternativa mas adecuada.`;
}

export function createResetConversationState() {
	return {
		customerName: null,
		lastIntent: null,
		lastDetectedIntent: null,
		lastUserGoal: null,
		lastOrderNumber: null,
		lastOrderId: null,
		preferredTone: null,
		customerMood: null,
		urgencyLevel: null,
		frequentSize: null,
		paymentPreference: null,
		deliveryPreference: null,
		interestedProducts: [],
		objections: [],
		needsHuman: false,
		handoffReason: null,
		interactionCount: 0,
		notes: null,
		currentProductFocus: null,
		currentProductFamily: null,
		requestedOfferType: null,
		excludedProductKeywords: [],
		categoryLocked: false,
		salesStage: null,
		shownOffers: [],
		shownPrices: [],
		sharedLinks: [],
		lastRecommendedProduct: null,
		lastRecommendedOffer: null,
		buyingIntentLevel: null,
		frictionLevel: null,
		commercialSummary: null,
		campaignContext: null,
		pendingAutoReplyMessageId: null,
		pendingAutoReplyDueAt: null,
		pendingAutoReplyLockedAt: null,
		menuActive: false,
		menuPath: null,
		menuLastSelection: null,
		menuLastPromptAt: null,
	};
}

export function buildConversationSummary({
	intent,
	enrichedState,
	lastUserMessage,
	lastAssistantMessage,
	liveOrderContext,
	commercialPlan = null,
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

	if (enrichedState?.currentProductFamily) {
		parts.push(`Familia: ${enrichedState.currentProductFamily}`);
	}

	if (commercialPlan?.productFocus) {
		parts.push(`Foco: ${commercialPlan.productFocus}`);
	}

	if (enrichedState?.requestedOfferType) {
		parts.push(`Promo pedida: ${enrichedState.requestedOfferType}`);
	}

	if (enrichedState?.excludedProductKeywords?.length) {
		parts.push(`Excluir: ${enrichedState.excludedProductKeywords.join(', ')}`);
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
		parts.push(
			`Derivar: ${
				enrichedState.handoffReason || commercialPlan?.handoffReason || 'sí'
			}`
		);
	}

	if (lastUserMessage) {
		parts.push(`Último cliente: ${summarizeText(lastUserMessage, 120)}`);
	}

	if (lastAssistantMessage) {
		parts.push(`Última respuesta: ${summarizeText(lastAssistantMessage, 120)}`);
	}

	return parts.filter(Boolean).join(' | ');
}

export function buildAiFailureFallback({
	workspaceId = '',
	intent,
	enrichedState,
	catalogProducts = [],
	commercialPlan = null,
}) {
	const useDkvHandoff = isDkvWorkspace(workspaceId);
	const firstProduct =
		Array.isArray(catalogProducts) && catalogProducts.length ? catalogProducts[0] : null;

	if (commercialPlan?.shouldEscalate || enrichedState?.needsHuman) {
		if (useDkvHandoff) return buildUnableToContinueHandoffReply();
		return 'Te paso con una asesora para seguir mejor con esto.';
	}

	if (intent === 'product' && commercialPlan?.catalogAvailable === false) {
		if (useDkvHandoff) return buildUnableToContinueHandoffReply();
		const familyLabel =
			commercialPlan?.productFamilyLabel ||
			commercialPlan?.productFamily ||
			enrichedState?.currentProductFocus ||
			enrichedState?.currentProductFamily ||
			'ese producto';
		return `Ahora no estoy viendo el catálogo actualizado de ${familyLabel}, así que no te quiero inventar una promo o un link equivocado. Si querés, decime color o talle, o te paso con una asesora.`;
	}

	if (intent === 'product') {
		if (
			commercialPlan?.recommendedAction === 'explain_requested_offer_unavailable_keep_family' &&
			commercialPlan?.requestedOfferType
		) {
			const familyLabel =
				commercialPlan?.productFamilyLabel ||
				commercialPlan?.productFamily ||
				enrichedState?.currentProductFamily ||
				'esa familia';
			const fallbackLabel =
				commercialPlan?.fallbackOffer?.offerLabel ||
				commercialPlan?.fallbackOffer?.name ||
				null;

			return fallbackLabel
				? `No estoy viendo una ${commercialPlan.requestedOfferType} exacta dentro de ${familyLabel}. Lo más parecido que sí tengo confirmado es ${fallbackLabel}.`
				: `No estoy viendo una ${commercialPlan.requestedOfferType} exacta confirmada dentro de ${familyLabel}. Si querés, te muestro la alternativa más cercana sin salir de esa familia.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_offer_options_brief' &&
			commercialPlan?.offerOptions?.length
		) {
			const brief = commercialPlan.offerOptions
				.slice(0, 3)
				.map((option) => option.label || `${option.name}${option.price ? ` (${option.price})` : ''}`)
				.join(', ');
			return `En este producto solemos tener ${brief}. Si querés, te digo cuál te conviene más.`;
		}

		if (commercialPlan?.recommendedAction === 'guide_and_discover') {
			return 'Tenemos opción individual y también promos. Si querés, te cuento rápido las más elegidas o te paso la web para que las veas.';
		}

		if (commercialPlan?.recommendedAction === 'send_general_catalog_first') {
			return buildCatalogOptionsReply(catalogProducts);
		}

		if (commercialPlan?.recommendedAction === 'clarify_specific_product') {
			if (useDkvHandoff) return buildUnableToContinueHandoffReply();
			const familyLabel =
				commercialPlan?.productFamilyLabel ||
				commercialPlan?.productFamily ||
				enrichedState?.currentProductFamily ||
				'ese producto';
			return `No quiero confundirte con una opcion que no sea. Decime el nombre exacto o pasame el link del producto de ${familyLabel} y lo reviso puntual.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_single_best_offer' &&
			commercialPlan?.bestOffer
		) {
			return `${commercialPlan.bestOffer.name}${
				commercialPlan.bestOffer.price ? ` por ${commercialPlan.bestOffer.price}` : ''
			}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'present_price_once' &&
			commercialPlan?.bestOffer
		) {
			return `${commercialPlan.bestOffer.name} está ${commercialPlan.bestOffer.price}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'confirm_variant_and_continue' &&
			commercialPlan?.bestOffer
		) {
			return `Sí, lo trabajamos en esa opción. Si querés seguimos con ${commercialPlan.bestOffer.name}.`;
		}

		if (
			commercialPlan?.recommendedAction === 'close_with_single_link' &&
			commercialPlan?.bestOffer?.productUrl
		) {
			return `Te paso el link de esa opción: ${commercialPlan.bestOffer.productUrl}`;
		}

		if (commercialPlan?.recommendedAction === 'invite_to_catalog_and_offer_help') {
			return 'Podés mirar las opciones en la web y si querés te ayudo a elegir la que más te convenga.';
		}

		return firstProduct?.productUrl
			? 'Si querés, te paso la web y te ayudo a elegir la opción más conveniente.'
			: 'Contame qué producto buscás y te oriento.';
	}

	if (intent === 'payment') {
		return 'Aceptamos transferencia y tarjetas. Si querés, te digo cómo seguir con esa opción.';
	}

	if (intent === 'shipping') {
		return 'Hacemos envíos. Decime tu zona o ciudad y te cuento cómo sería en tu caso.';
	}

	if (intent === 'size_help') {
		return 'Decime qué talle usás normalmente y te oriento con eso.';
	}

	if (intent === 'order_status') {
		return 'Pasame tu número de pedido y te reviso el estado por acá.';
	}

	return 'Contame un poco más y te ayudo por acá.';
}

function messageLooksLikeSpecificCatalogCheck(messageBody = '') {
	const text = normalizeText(messageBody).toLowerCase();
	if (!text) return false;

	return (
		/(tenes|tienen|venden|hay|queda|viene|vienen|trabajan)/i.test(text) &&
		/(talle|talles|color|colores|stock|disponible|xl|xxl|xxxl|s\/m|m\/l|l\/xl|negro|blanco|beige|celeste|azul|verde|rosa|gris)/i.test(text)
	);
}

export function shouldForceCatalogSafetyFallback({
	intent,
	messageBody = '',
	enrichedState = {},
	catalogProducts = [],
	commercialPlan = null,
} = {}) {
	const hasCatalogMatch = Array.isArray(catalogProducts) && catalogProducts.length > 0;
	if (hasCatalogMatch) return false;

	if (commercialPlan?.catalogAvailable === false) return true;

	if (intent === 'size_help' || intent === 'stock_check') return true;

	if (intent === 'product' && !commercialPlan?.bestOffer) return true;

	if (
		intent === 'general' &&
		messageLooksLikeSpecificCatalogCheck(messageBody) &&
		!enrichedState?.currentProductFocus &&
		!enrichedState?.currentProductFamily
	) {
		return true;
	}

	return false;
}

export function buildCatalogSafetyFallback({
	workspaceId = '',
	intent,
	messageBody = '',
	enrichedState = {},
	commercialPlan = null,
} = {}) {
	if (isDkvWorkspace(workspaceId)) {
		return buildUnableToContinueHandoffReply();
	}

	const familyLabel =
		commercialPlan?.productFamilyLabel ||
		commercialPlan?.productFamily ||
		enrichedState?.currentProductFocus ||
		enrichedState?.currentProductFamily ||
		'ese producto';

	if (intent === 'size_help' || intent === 'stock_check') {
		return `No te lo quiero confirmar mal: ahora no tengo una coincidencia clara en catálogo para ${familyLabel}. Si querés, decime el nombre exacto del producto y te lo reviso puntual.`;
	}

	if (intent === 'product') {
		return `No te quiero decir que sí y pifiarle. Ahora no estoy viendo una coincidencia confirmada para ${familyLabel}. Si querés, pasame el nombre exacto o el link del producto y lo reviso bien.`;
	}

	if (intent === 'general' && messageLooksLikeSpecificCatalogCheck(messageBody)) {
		return 'No te lo quiero confirmar mal. Si me decís el nombre exacto del producto, color o talle que buscás, te lo reviso puntual.';
	}

	return 'No te lo quiero confirmar mal. Si me pasás el nombre exacto del producto, te lo reviso bien.';
}

export function buildResponsePolicy({
	intent,
	enrichedState,
	aiGuidance,
	liveOrderContext,
	queueDecision,
	commercialPlan,
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
			tone: 'empatico_concreto',
		};
	}

	if (intent === 'order_status') {
		if (!liveOrderContext) {
			return {
				action: 'ask_order_number_or_not_found',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 220,
				tone: 'postventa_clara',
			};
		}

		if (liveOrderContext.trackingUrl || liveOrderContext.trackingNumber) {
			return {
				action: 'order_status_with_tracking',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 320,
				tone: 'postventa_clara',
			};
		}

		return {
			action: 'order_status_without_tracking',
			useAI: false,
			allowHandoffMention: false,
			maxChars: 320,
			tone: 'postventa_clara',
		};
	}

	if (intent === 'payment') {
		return {
			action: 'payment_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'shipping') {
		return {
			action: 'shipping_guidance',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'size_help') {
		return {
			action: 'size_help',
			useAI: true,
			allowHandoffMention: false,
			maxChars: 220,
			tone: 'amigable_directo',
		};
	}

	if (intent === 'product') {
		if (commercialPlan?.catalogAvailable === false) {
			return {
				action: 'product_catalog_unavailable',
				useAI: false,
				allowHandoffMention: false,
				maxChars: 260,
				tone: 'amigable_directo',
			};
		}

		return {
			action: commercialPlan?.recommendedAction || 'product_guidance',
			useAI:
				!['clarify_specific_product', 'send_general_catalog_first', 'guide_and_discover'].includes(
					commercialPlan?.recommendedAction
				),
			allowHandoffMention: false,
			maxChars:
				commercialPlan?.recommendedAction === 'close_with_single_link'
					? 200
					: commercialPlan?.recommendedAction === 'present_offer_options_brief'
						? 240
						: commercialPlan?.recommendedAction === 'guide_and_discover' ||
						  commercialPlan?.recommendedAction === 'invite_to_catalog_and_offer_help'
							? 230
							: commercialPlan?.recommendedAction === 'present_single_best_offer'
								? 180
								: 220,
			tone:
				commercialPlan?.mood === 'angry'
					? 'empatico_concreto'
					: 'guia_comercial_directa',
		};
	}

	return {
		action: 'general_help',
		useAI: true,
		allowHandoffMention: false,
		maxChars: 220,
		tone: enrichedState?.preferredTone || 'amigable_directo',
	};
}

function normalizeGateText(value = '') {
	return normalizeText(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function isAiOutbound(message = null) {
	if (!message || message.direction !== 'OUTBOUND') return false;
	return (
		['gemini', 'openai'].includes(String(message.provider || '').toLowerCase()) ||
		/gemini|gpt/i.test(String(message.model || ''))
	);
}

function isSimpleClosingMessage(text = '') {
	return looksLikeSimpleClosing(text);
	const q = normalizeGateText(text);
	if (!q) return false;

	return /^(ok|okay|oka|dale|listo|gracias|muchas gracias|mil gracias|perfecto|genial|buenisimo|buenisimo gracias|bueno gracias|de nada|👍|🙏|🙌)[\s!.]*$/i.test(q);
}

function isReactionLikeMessage(messageType = '', body = '') {
	const normalizedType = String(messageType || '').toLowerCase();
	if (['reaction', 'sticker', 'contacts'].includes(normalizedType)) return true;
	if (normalizedType !== 'text' && !normalizeText(body)) return true;
	return false;
}

function lastAssistantAskedQuestion(message = null) {
	if (!message?.body) return false;
	const text = String(message.body || '');
	return /\?\s*$/.test(text) || /(?:decime|pasame|confirmame|enviame|mandame|contame|indicam[eé])\b/i.test(text);
}

function looksLikeCancellationRequest(text = '') {
	return looksLikeCancellationRequestSignal(text);
	const q = normalizeGateText(text);
	return /(cancelar|cancelen|anular|anulen|dar de baja).*(compra|pedido|orden|carrito)|(?:compra|pedido|orden).*(cancelar|cancelen|anular|anulen|dar de baja)/i.test(q);
}

function looksLikeReturnOrWrongItemRequest(text = '') {
	return looksLikeReturnOrWrongItemRequestSignal(text);
	const q = normalizeGateText(text);
	return /(devolucion|devolver|devuelvan|devolv|reembolso|reintegro|arrepentimiento|cambio|cambiar|me quedo chico|me quedo grande|me llego mal|vino mal|vino fallado|vino roto|me mandaron otro|no coincide|sin color|talle equivocado|color equivocado|envien.*(?:calza|producto)|dinero)/i.test(q);
}

function looksLikeReturnCaseFollowup(text = '') {
	const q = normalizeGateText(text);
	return /(?:orden|pedido|#)?\s*\d{4,10}\b|foto|etiqueta|talle|color|tabla|no coincide|detalle|adjunto|te paso/i.test(q);
}

function isReturnExchangeAlreadyRouted(currentState = {}, lastOutbound = null) {
	if (currentState?.handoffReason === 'return_exchange') return true;

	const lastText = normalizeGateText(lastOutbound?.body || '');
	return /devolucion|cambio automatico|asesora vea tu caso|queda derivado para revisarlo/.test(lastText);
}

function isReturnExchangeFinalHandoffSent(currentState = {}, lastOutbound = null) {
	if (currentState?.handoffReason !== 'return_exchange') return false;

	const lastText = normalizeGateText(lastOutbound?.body || '');
	return /ya sumo ese dato al caso|queda derivado para que una asesora/.test(lastText);
}

function isWaitingForHuman(currentState = {}) {
	return Boolean(currentState?.needsHuman && currentState?.handoffReason);
}

function isHumanHandoffWithinSilenceWindow(currentState = {}, hours = 24) {
	if (!isWaitingForHuman(currentState)) return false;
	const updatedAt = currentState?.updatedAt ? new Date(currentState.updatedAt).getTime() : 0;
	if (!updatedAt || !Number.isFinite(updatedAt)) return true;
	return Date.now() - updatedAt < hours * 60 * 60 * 1000;
}

function looksLikeSameHandoffTopic(text = '', currentState = {}) {
	const q = normalizeGateText(text);
	const reason = String(currentState?.handoffReason || '');
	if (!q) return true;

	if (reason === 'return_exchange') {
		return looksLikeReturnOrWrongItemRequest(q) || looksLikeReturnCaseFollowup(q);
	}

	if (reason === 'tracking_followup') {
		return looksLikeTrackingEscalation(q) || /(seguimiento|tracking|envio|enbox|correo|pedido|demora|llega|direccion)/i.test(q);
	}

	if (reason === 'cancel_request') {
		return looksLikeCancellationRequest(q) || /(cancel|anular|pedido|compra)/i.test(q);
	}

	return /(pedido|envio|seguimiento|tracking|devolucion|cambio|cancel|reclamo|asesora|humano|comprobante|pago)/i.test(q);
}

function lastOutboundSharedTracking(lastOutbound = null) {
	const text = normalizeGateText(lastOutbound?.body || '');
	return /(podes seguirlo|seguimiento|tracking|codigo de seguimiento|link de seguimiento|correo\/logistica|correo argentino|enbox|pedido #[0-9])/.test(text) &&
		/(https?:\/\/|podes seguirlo|codigo de seguimiento|link de seguimiento|correo argentino|enbox)/.test(text);
}

function looksLikeTrackingEscalation(text = '') {
	const q = normalizeGateText(text);
	return /(\bpero\b|demora|demorado|demorando|tarda|tardando|hace\s+\w+\s+(dia|dias|semana|semanas)|no llega|no me llego|no avanza|no se mueve|ni avanzo|sigue igual|preparando|cuando lo van a enviar|cuando sale|hoy tenia que llegar|reclamo|necesito cambiar|cambiar.*domicilio|cambio.*domicilio|direccion|direcci[oó]n|me responden)/i.test(q);
}

function looksLikeTrackingClosing(text = '') {
	const q = normalizeGateText(text);
	return /^(ok|oki|oka|dale|perfecto|joya|bueno|listo|gracias|muchas gracias|espero|espero entonces|quedo atenta|quedo atento|aguardo|aguardo entonces)[\s!.]*$/i.test(q) ||
		/(gracias|perfecto|espero entonces|aguardo entonces|quedo atent[ao])/.test(q);
}

function looksLikeSensitiveSupport(text = '') {
	return looksLikeSensitiveSupportSignal(text);
	const q = normalizeGateText(text);
	return /(estafa|defensa del consumidor|denuncia|reclamo|verg[uü]enza|me bloquearon|bloquearon|no responden|nadie responde|se borran|me llego mal|vino mal|devolucion|devolver|arrepentimiento)/i.test(q);
}

function looksLikeRapidContinuation(text = '') {
	return looksLikeRapidContinuationSignal(text);
	const q = normalizeGateText(text);
	if (!q) return false;
	if (looksLikeExplicitHumanRequest(q) || looksLikeCustomerFrustration(q)) return false;
	if (/\d/.test(q) || /\b(quiero|necesito|talle|foto|imagen|cuando|hay|tenes|tienes|stock|precio)\b/i.test(q)) return false;
	if (String(text || '').includes('?')) return false;
	return q.length <= 80 || /^(tambien|ademas|y |ah |me |yo |pero |igual |ya |es que|xq|porque)/i.test(q);
}

export function isSupportIntent(intent = '') {
	return ['order_status', 'complaint', 'return_exchange', 'human_handoff'].includes(
		String(intent || '')
	);
}

export function sanitizeStateForSupportPrompt(state = {}, intent = '') {
	if (!isSupportIntent(intent)) return state;

	return {
		...state,
		currentProductFocus: null,
		currentProductFamily: null,
		requestedOfferType: null,
		categoryLocked: false,
		salesStage: null,
		shownOffers: [],
		shownPrices: [],
		sharedLinks: [],
		lastRecommendedProduct: null,
		lastRecommendedOffer: null,
		buyingIntentLevel: null,
		commercialSummary: null,
	};
}

export function resolveReplyGate({
	workspaceId = '',
	messageBody = '',
	messageType = 'text',
	intent = 'general',
	currentState = {},
	lastOutbound = null,
	recentMessages = [],
	currentMessageAt = null,
	campaignAssistantContext = null,
} = {}) {
	const text = normalizeText(messageBody);
	const q = normalizeGateText(text);
	const shouldUseDkvHandoffReply = isDkvWorkspace(workspaceId);
	const handoffFallbackReply = shouldUseDkvHandoffReply
		? buildUnableToContinueHandoffReply()
		: null;

	if (!text || isReactionLikeMessage(messageType, messageBody)) {
		return {
			action: 'suppress',
			reason: 'non_text_or_empty_signal',
		};
	}

	const lastOutboundAt = lastOutbound?.createdAt ? new Date(lastOutbound.createdAt).getTime() : 0;
	const currentAt = currentMessageAt ? new Date(currentMessageAt).getTime() : Date.now();
	const secondsSinceLastAi =
		lastOutboundAt && isAiOutbound(lastOutbound)
			? (currentAt - lastOutboundAt) / 1000
			: Number.POSITIVE_INFINITY;
	const preSaleObjection = shouldTreatAsPreSaleObjection({
		text,
		campaignContext: campaignAssistantContext,
		currentState,
	});

	if (!preSaleObjection && looksLikeExplicitHumanRequest(q)) {
		return {
			action: 'fixed_reply',
			reason: 'explicit_human_request',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'requested_human',
			},
			reply:
				handoffFallbackReply ||
				'Te paso con una asesora para que lo vea una persona. Dejo el chat derivado y seguimos por aca.',
		};
	}

	if (!preSaleObjection && looksLikeCustomerFrustration(q)) {
		return {
			action: 'fixed_reply',
			reason: 'customer_frustration_needs_human',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'customer_frustration',
			},
			reply:
				handoffFallbackReply ||
				'Entiendo. Para no marearte con una respuesta incompleta, te paso con una asesora y dejamos este caso para revision humana.',
		};
	}

	if (shouldUseDkvHandoffReply && looksLikeDkvSensitiveRequest(text)) {
		return {
			action: 'fixed_reply',
			reason: 'sensitive_support',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'sensitive_support',
			},
			reply: handoffFallbackReply,
		};
	}

	if (
		secondsSinceLastAi >= 0 &&
		secondsSinceLastAi <= 10 &&
		looksLikeRapidContinuation(text) &&
		!['payment', 'order_status', 'human_handoff'].includes(String(intent || ''))
	) {
		return {
			action: 'suppress',
			reason: 'rapid_customer_continuation_after_ai',
		};
	}

	if (
		isSimpleClosingMessage(text) &&
		!lastAssistantAskedQuestion(lastOutbound) &&
		!['payment', 'order_status', 'human_handoff'].includes(String(intent || ''))
	) {
		return {
			action: 'suppress',
			reason: 'simple_closing',
		};
	}

	if (
		secondsSinceLastAi <= 8 &&
		isSimpleClosingMessage(text) &&
		!lastAssistantAskedQuestion(lastOutbound)
	) {
		return {
			action: 'suppress',
			reason: 'rapid_ack_after_ai',
		};
	}

	if (isReturnExchangeFinalHandoffSent(currentState, lastOutbound)) {
		return {
			action: 'suppress',
			reason: 'return_exchange_waiting_human',
		};
	}

	if (lastOutboundSharedTracking(lastOutbound) && looksLikeTrackingClosing(q)) {
		return {
			action: 'suppress',
			reason: 'tracking_closing_after_status',
		};
	}

	if (lastOutboundSharedTracking(lastOutbound) && looksLikeTrackingEscalation(q)) {
		return {
			action: 'fixed_reply',
			reason: 'tracking_followup_needs_human',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'tracking_followup',
			},
			reply:
				handoffFallbackReply ||
				'Entiendo. Ya tenemos el seguimiento cargado, pero si no avanza o necesitas cambiar un dato del envio, lo tiene que revisar una asesora. Dejo el caso derivado para que lo vean por aca.',
		};
	}

	if (
		isReturnExchangeAlreadyRouted(currentState, lastOutbound) &&
		(looksLikeReturnOrWrongItemRequest(q) ||
		 looksLikeReturnCaseFollowup(q) ||
		 ['image', 'document'].includes(String(messageType || '').toLowerCase()))
	) {
		return {
			action: 'fixed_reply',
			reason: 'return_exchange_followup_received',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'return_exchange',
			},
			reply:
				handoffFallbackReply ||
				'Gracias, ya sumo ese dato al caso. Queda derivado para que una asesora lo revise y te responda por aca. Si podes, mandanos tambien una foto del producto o de la etiqueta para acelerar la revision.',
		};
	}

	if (isWaitingForHuman(currentState)) {
		if (
			isHumanHandoffWithinSilenceWindow(currentState) ||
			looksLikeSameHandoffTopic(q, currentState)
		) {
			return {
				action: 'suppress',
				reason: 'waiting_human_handoff',
			};
		}

		return {
			action: 'reply',
			reason: 'handoff_expired_new_topic',
		};
	}

	if (looksLikeCancellationRequest(q)) {
		return {
			action: 'fixed_reply',
			reason: 'cancel_request_needs_human',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'cancel_request',
			},
			reply:
				handoffFallbackReply ||
				'Puedo dejar el pedido para que lo revise una asesora, pero no te confirmo una cancelacion automatica desde aca. Te derivamos para verlo bien.',
		};
	}

	if (!preSaleObjection && looksLikeReturnOrWrongItemRequest(q)) {
		return {
			action: 'fixed_reply',
			reason: 'return_exchange_needs_human',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'return_exchange',
			},
			reply:
				handoffFallbackReply ||
				'Entiendo, lo revisamos. Para que una asesora vea tu caso puntual, pasame el numero de pedido y una foto del producto o etiqueta si la tenes. No te confirmo una devolucion o cambio automatico desde aca, pero queda derivado para revisarlo bien.',
		};
	}

	if (!preSaleObjection && looksLikeSensitiveSupport(q)) {
		return {
			action: 'fixed_reply',
			reason: 'sensitive_support',
			queue: 'HUMAN',
			aiEnabled: false,
			statePatch: {
				needsHuman: true,
				handoffReason: 'sensitive_support',
			},
			reply:
				handoffFallbackReply ||
				'Entiendo la preocupacion. Te paso con una asesora para revisar tu caso puntual y evitar darte una respuesta incompleta desde aca.',
		};
	}

	if (
		recentMessages.filter((message) => message.role === 'assistant').slice(-2).length >= 2 &&
		isSimpleClosingMessage(text)
	) {
		return {
			action: 'suppress',
			reason: 'closing_after_multiple_assistant_replies',
		};
	}

	return {
		action: 'reply',
		reason: null,
	};
}

export function stripRepeatedGreeting(text = '', recentMessages = [], contactName = '', preserveGreeting = false) {
	if (preserveGreeting) return text;
	const assistantCount = recentMessages.filter((msg) => msg.role === 'assistant').length;
	if (assistantCount === 0) return text;

	let next = String(text || '').trim();
	const name = String(contactName || '').trim();
	const escapedName = name ? name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
	const patterns = [
		/^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)(?:[,!\s-]+(?:soy\s+[^,!.]+|[^,!.]+\s+de\s+[^,!.]+))?[,:!\s-]*/i,
		escapedName
			? new RegExp(
					`^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,\\s-]+${escapedName}[,:!?\\s-]*`,
					'i'
			  )
			: null,
		escapedName ? new RegExp(`^${escapedName}[,:!?\\s-]*`, 'i') : null,
		/^soy\s+[^,!.]+\s+de\s+[^,!.]+[,:!\s-]*/i,
	].filter(Boolean);

	let changed = true;
	let safety = 0;
	while (changed && safety < 6) {
		changed = false;
		safety += 1;
		for (const pattern of patterns) {
			if (pattern.test(next)) {
				next = next.replace(pattern, '').trim();
				changed = true;
			}
		}
	}

	return next || text;
}

function stripRepeatedIdentity(text = '', recentMessages = [], contactName = '', agentName = 'Sofi', businessName = 'la marca', preserveGreeting = false) {
	if (preserveGreeting) return text;

	const assistantCount = recentMessages.filter((msg) => msg.role === 'assistant').length;
	if (assistantCount === 0) return text;

	let next = String(text || '').trim();
	const safeContactName = String(contactName || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const safeAgentName = String(agentName || 'Sofi').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const safeBusinessName = String(businessName || 'la marca').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	const identityPatterns = [
		safeContactName ? new RegExp(`^${safeContactName}[,:!?\\s-]+`, 'i') : null,
		new RegExp(`^soy\\s+${safeAgentName}\\s+de\\s+${safeBusinessName}[,:!?\\s-]*`, 'i'),
		new RegExp(`^${safeAgentName}\\s+de\\s+${safeBusinessName}[,:!?\\s-]*`, 'i'),
		new RegExp(`^${safeContactName ? `${safeContactName}[,:!?\\s-]+` : ''}soy\\s+${safeAgentName}\\s+de\\s+${safeBusinessName}[,:!?\\s-]*`, 'i'),
	].filter(Boolean);

	let changed = true;
	let safety = 0;
	while (changed && safety < 6) {
		changed = false;
		safety += 1;
		for (const pattern of identityPatterns) {
			if (pattern.test(next)) {
				next = next.replace(pattern, '').trim();
				changed = true;
			}
		}
	}

	return next || text;
}

function ensureGeneralPresentation(text = '', { preserveGreeting = false, businessName = 'la marca', agentName = 'Sofi' } = {}) {
	if (!preserveGreeting) return text;

	const normalized = normalizeText(text);
	if (!normalized) {
		return `Hola, soy ${agentName} de ${businessName}.`;
	}

	const safeAgentName = String(agentName || 'Sofi').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const safeBusinessName = String(businessName || 'la marca').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	if (new RegExp(`soy\\s+${safeAgentName}\\s+de\\s+${safeBusinessName}`, 'i').test(normalized)) return normalized;

	const withoutLeadingGreeting = normalized.replace(
		/^(?:¡)?(?:hola|buenas|buen dia|buen día|buenas tardes|buenas noches)[,!.\s-]*/i,
		''
	).trim();

	if (!withoutLeadingGreeting) {
		return `Hola, soy ${agentName} de ${businessName}. ¿En que te puedo ayudar?`;
	}

	return `Hola, soy ${agentName} de ${businessName}. ${withoutLeadingGreeting}`.trim();
}

export function stripBotOpenings(text = '') {
	let next = String(text || '').trim();
	const openingPattern =
		/^(?:¡)?(?:claro|perfecto|genial|buen[ií]simo|buenisimo|dale|obvio|excelente)(?:[,!\s-]+)(.*)$/i;
	let safety = 0;

	while (openingPattern.test(next) && safety < 3) {
		next = next.replace(openingPattern, '$1').trim();
		safety += 1;
	}

	return next || text;
}

function responseMentionsHumanHandoff(text = '') {
	return /(te paso con una asesora|te paso con un asesor|te derivo con una asesora|te derivo con un asesor|lo revisa una asesora|lo revisa un asesor|ya lo toma una persona|te contacta el equipo|atencion humana|atención humana|cuando un asesor este disponible|cuando una asesora este disponible|asesor este disponible|asesora este disponible)/i.test(
		String(text || '')
	);
}

function looksLikeInventedCommercialReply(text = '', commercialPlan = null) {
	if (commercialPlan?.catalogAvailable !== false) return false;
	const normalized = String(text || '').toLowerCase();
	return (
		/(2x1|3x1|pack|combo|promo|promocion|promoción|oferta)/i.test(normalized) ||
		/\$\s?\d/.test(normalized) ||
		/https?:\/\//i.test(normalized) ||
		/\blink\b|\burl\b/i.test(normalized)
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

function looksLikeUnsupportedOperationalPromise(text = '', responsePolicy = {}) {
	const normalized = normalizeGateText(text);
	const action = String(responsePolicy?.action || '');

	if (
		/(ya\s+)?(te\s+)?(cancelo|cancelamos|anulo|anulamos|di de baja|damos de baja)\b/i.test(
			normalized
		)
	) {
		return true;
	}

	if (
		/(ya\s+)?(lo\s+)?(revise|revisamos|estoy revisando|me fijo|lo verifico|verificamos)\b/i.test(
			normalized
		) &&
		!/(order_status|payment|handoff)/i.test(action)
	) {
		return true;
	}

	if (
		/(podemos coordinar|gestionamos|se puede enviar por oca|via cargo|andreani sin problema|sin problema)/i.test(
			normalized
		) &&
		action !== 'shipping_guidance'
	) {
		return true;
	}

	return false;
}

function looksLikeUnsupportedMediaPromise(text = '') {
	const normalized = normalizeGateText(text);
	return (
		/\[(imagen|foto|video|catalogo|cat[aá]logo)[^\]]*\]/i.test(String(text || '')) ||
		/(te\s+(muestro|mando|paso|envio|envio)\s+(la\s+)?(foto|imagen|video)|busco\s+el\s+video|en\s+un\s+ratito\s+te\s+lo\s+paso)/i.test(normalized)
	);
}

export function auditAssistantReply({
	text,
	responsePolicy,
	liveOrderContext,
	fallbackReply,
	commercialPlan,
	recentMessages = [],
	contactName = '',
	businessName = 'la marca',
	agentName = 'Sofi',
}) {
	const rawText = typeof text === 'string' ? text : text?.text || String(text || '');
	const preserveGreeting = Boolean(commercialPlan?.greetingOnly);
	let cleaned = normalizeText(rawText);
	cleaned = stripRepeatedGreeting(cleaned, recentMessages, contactName, preserveGreeting);
	cleaned = stripRepeatedIdentity(cleaned, recentMessages, contactName, agentName, businessName, preserveGreeting);
	cleaned = stripBotOpenings(cleaned);
	cleaned = normalizeText(cleaned);

	if (!cleaned) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (
		responsePolicy?.action?.startsWith('order_status') &&
		looksLikeInventedTracking(cleaned, liveOrderContext)
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (
		commercialPlan?.shareLinkNow === false &&
		commercialPlan?.alreadyShared?.sharedLinks?.some((link) => cleaned.includes(link))
	) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (looksLikeInventedCommercialReply(cleaned, commercialPlan)) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (looksLikeUnsupportedOperationalPromise(cleaned, responsePolicy)) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	if (looksLikeUnsupportedMediaPromise(cleaned)) {
		return {
			finalText: fallbackReply,
			triggerHumanHandoff: false,
		};
	}

	const triggerHumanHandoff =
		commercialPlan?.shouldEscalate || responseMentionsHumanHandoff(cleaned);

	const finalText = ensureGeneralPresentation(cleaned, {
		preserveGreeting,
		businessName,
		agentName,
	});

	return {
		finalText,
		triggerHumanHandoff,
	};
}

export async function resolveIntentAction({
	workspaceId,
	intent,
	messageBody,
	explicitOrderNumber,
	currentState,
}) {
	if (isDkvWorkspace(workspaceId) && looksLikeDkvCatalogRequest(messageBody)) {
		return {
			handled: true,
			forcedReply: buildDkvCatalogReply(),
			liveOrderContext: null,
			aiGuidance: {
				type: 'catalog_overview',
				source: 'dkv_vecindario_context',
			},
		};
	}

	if (isDkvWorkspace(workspaceId) && looksLikeDkvOfficeRequest(messageBody)) {
		return {
			handled: true,
			forcedReply: buildDkvOfficeReply(),
			liveOrderContext: null,
			aiGuidance: {
				type: 'office_contact',
				source: 'dkv_vecindario_context',
			},
		};
	}

	if (intent === 'order_status') {
		return handleOrderStatusIntent({ explicitOrderNumber, currentState, workspaceId });
	}

	if (intent === 'payment') {
		return handlePaymentIntent({ currentState, workspaceId });
	}

	if (intent === 'shipping') {
		return handleShippingIntent({ messageBody, currentState });
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
		aiGuidance: null,
	};
}

export function buildStatePayload({
	contactName,
	normalizedWaId,
	intent,
	explicitOrderNumber,
	liveOrderContext,
	currentState,
	memoryPatch,
	menuStatePatch = null,
}) {
	const shouldKeepOrderContext =
		intent === 'order_status' ||
		(currentState?.lastIntent === 'order_status' && explicitOrderNumber);
	const shouldClearCommercialContext = isSupportIntent(intent);

	const interestedProducts = Array.isArray(menuStatePatch?.interestedProducts)
		? menuStatePatch.interestedProducts
		: memoryPatch.interestedProducts;

	const nextProductFamily =
		memoryPatch?.currentProductFamily ||
		menuStatePatch?.currentProductFamily ||
		currentState?.currentProductFamily ||
		null;
	const familyChanged =
		Boolean(nextProductFamily) &&
		Boolean(currentState?.currentProductFamily) &&
		nextProductFamily !== currentState.currentProductFamily;

	const excludedProductKeywords = familyChanged
		? Array.isArray(memoryPatch?.excludedProductKeywords)
			? memoryPatch.excludedProductKeywords
			: []
		: Array.isArray(memoryPatch?.excludedProductKeywords) && memoryPatch.excludedProductKeywords.length
			? [...new Set([...(Array.isArray(currentState?.excludedProductKeywords) ? currentState.excludedProductKeywords : []), ...memoryPatch.excludedProductKeywords])]
			: Array.isArray(currentState?.excludedProductKeywords)
				? currentState.excludedProductKeywords
				: [];

	return {
		customerName: contactName || normalizedWaId,
		lastIntent: shouldKeepOrderContext ? 'order_status' : intent,
		lastDetectedIntent: memoryPatch.lastDetectedIntent,
		lastUserGoal: memoryPatch.lastUserGoal,
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
		notes: currentState?.notes || null,
		currentProductFocus: shouldClearCommercialContext
			? null
			: menuStatePatch?.currentProductFocus ||
			  memoryPatch?.currentProductFocus ||
			  currentState?.currentProductFocus ||
			  null,
		currentProductFamily: shouldClearCommercialContext ? null : nextProductFamily,
		requestedOfferType:
			shouldClearCommercialContext
				? null
				: memoryPatch?.requestedOfferType ||
				  (familyChanged ? null : currentState?.requestedOfferType) ||
				  null,
		excludedProductKeywords: shouldClearCommercialContext ? [] : excludedProductKeywords,
		categoryLocked: shouldClearCommercialContext
			? false
			: typeof memoryPatch?.categoryLocked === 'boolean'
				? memoryPatch.categoryLocked
				: Boolean(currentState?.categoryLocked),
		salesStage: shouldClearCommercialContext ? null : currentState?.salesStage || null,
		shownOffers: shouldClearCommercialContext ? [] : currentState?.shownOffers || [],
		shownPrices: shouldClearCommercialContext ? [] : currentState?.shownPrices || [],
		sharedLinks: shouldClearCommercialContext ? [] : currentState?.sharedLinks || [],
		lastRecommendedProduct: shouldClearCommercialContext
			? null
			: currentState?.lastRecommendedProduct || null,
		lastRecommendedOffer: shouldClearCommercialContext
			? null
			: currentState?.lastRecommendedOffer || null,
		buyingIntentLevel: shouldClearCommercialContext ? null : currentState?.buyingIntentLevel || null,
		frictionLevel: currentState?.frictionLevel || null,
		commercialSummary: shouldClearCommercialContext
			? null
			: currentState?.commercialSummary || null,
		menuActive: false,
		menuPath: null,
		menuLastSelection:
			menuStatePatch?.menuLastSelection || currentState?.menuLastSelection || null,
		menuLastPromptAt: currentState?.menuLastPromptAt || null,
	};
}

export function normalizeRecentMessage(msg = {}) {
	const direction = msg.direction || (msg.role === 'assistant' ? 'OUTBOUND' : 'INBOUND');
	return {
		role: direction === 'INBOUND' ? 'user' : 'assistant',
		text: String(msg.body || msg.text || ''),
	};
}

export function buildFallbackOrderAwareReply({
	workspaceId = '',
	intent,
	liveOrderContext,
	enrichedState,
	catalogProducts,
	commercialPlan,
	campaignAssistantContext = null,
}) {
	if (intent === 'order_status' && liveOrderContext) {
		return buildFixedOrderReply(liveOrderContext);
	}

	if (campaignAssistantContext?.category === 'pending_payment') {
		return 'Te ayudo con el pago pendiente. Para no duplicar nada, seguime por el mismo link o mandame el comprobante por aca si ya pagaste.';
	}

	if (campaignAssistantContext?.category === 'cart_recovery') {
		return 'Te ayudo con el carrito. Decime que duda te frena, talle, envio, cambio o pago, y lo resolvemos antes de que finalices la compra.';
	}

	if (campaignAssistantContext?.category === 'sales' || campaignAssistantContext?.category === 'marketing') {
		return 'Te ayudo con la promo. Decime que talle, color o producto estabas mirando y te paso una opcion concreta sin abrirte todo el catalogo.';
	}

	return buildAiFailureFallback({
		workspaceId,
		intent,
		enrichedState,
		catalogProducts,
		commercialPlan,
	});
}
