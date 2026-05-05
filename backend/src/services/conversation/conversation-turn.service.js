import { runAssistantReply } from '../ai/index.js';
import { buildPrompt } from '../common/prompt-builder.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import {
	detectIntent,
	extractOrderNumber,
	extractStandaloneOrderNumber
} from '../../lib/intent.js';
import {
	analyzeConversationTurn,
	buildHandoffReply
} from './conversation-analysis.service.js';
import { buildFixedOrderReply } from '../intents/order-status.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints,
	getCatalogLookupStatus
} from '../catalog/catalog-search.service.js';
import { resolveCommercialBrainV2 } from '../ai/commercial-brain.service.js';
import {
	isPaymentProofMessage,
	isAmbiguousPaymentAttachment,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';
import {
	normalizeText,
	createResetConversationState,
	buildConversationSummary,
	buildAiFailureFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	buildStatePayload,
	normalizeRecentMessage,
	buildFallbackOrderAwareReply,
} from './conversation-helpers.service.js';

export async function runConversationTurn({
	contactName,
	customerContext = {},
	messageBody,
	messageType = 'text',
	attachmentMeta = null,
	rawPayload = null,
	currentConversation = {},
	currentState = {},
	messages = [],
	workspaceId = currentConversation?.workspaceId,
	businessName = process.env.BUSINESS_NAME || 'la marca'
}) {
	const normalizedWaId = normalizeThreadPhone(
		customerContext?.waId || currentConversation?.waId || currentConversation?.phone || ''
	);
	const normalizedMessages = Array.isArray(messages) ? messages.map(normalizeRecentMessage) : [];

	const intent = detectIntent(messageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(messageBody, currentState) || extractStandaloneOrderNumber(messageBody);

	const recentMessages = normalizedMessages.slice(-8);
	const memoryPatch = analyzeConversationTurn({
		messageBody,
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
		body: messageBody,
		rawPayload,
		currentState,
		recentMessages
	});

	const ambiguousPaymentAttachment = isAmbiguousPaymentAttachment({
		messageType,
		body: messageBody,
		rawPayload,
		currentState,
		recentMessages
	});

	const queueDecision = resolveConversationQueue({
		currentConversation,
		memoryPatch,
		detectedPaymentProof,
		aiDeclaredHandoff: false
	});

	const intentResult = await resolveIntentAction({
		workspaceId,
		intent,
		messageBody,
		explicitOrderNumber,
		currentState
	});

	const aiGuidance = intentResult.aiGuidance || null;
	const liveOrderContext = intentResult.liveOrderContext || null;
	const forcedReply = intentResult.forcedReply || null;

	let nextStatePayload = buildStatePayload({
		contactName,
		normalizedWaId,
		intent,
		explicitOrderNumber,
		liveOrderContext,
		currentState,
		memoryPatch
	});

	let enrichedState = {
		...currentState,
		...nextStatePayload
	};

	if (ambiguousPaymentAttachment && !detectedPaymentProof) {
		const clarification =
			'Recibi la imagen o archivo. Es un comprobante de pago o queres que revise otra cosa de la foto?';
		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: {
				kind: 'payment_attachment_clarifier',
				body: clarification,
				aiMeta: {
					provider: 'system',
					model: 'payment-attachment-clarifier',
					raw: { ambiguousPaymentAttachment: true }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: clarification,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision,
				responsePolicy: null,
				commercialPlan: null,
				catalogProducts: [],
				commercialHints: [],
				prompt: null,
				assistantMessage: clarification,
				provider: 'system',
				model: 'payment-attachment-clarifier',
				aiGuidance,
				liveOrderContext
			}
		};
	}

	if (detectedPaymentProof) {
		const ack = buildPaymentReviewAck();
		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: {
				kind: 'payment_review_ack',
				body: ack,
				aiMeta: {
					provider: 'system',
					model: 'payment-proof-router',
					raw: { detectedPaymentProof: true }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: ack,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision,
				responsePolicy: null,
				commercialPlan: null,
				catalogProducts: [],
				commercialHints: [],
				prompt: null,
				assistantMessage: ack,
				provider: 'system',
				model: 'payment-proof-router',
				aiGuidance,
				liveOrderContext
			}
		};
	}

	const handoffJustTriggered = enrichedState.needsHuman && !currentState.needsHuman;

	if (handoffJustTriggered) {
		const handoffReply = buildHandoffReply({
			contactName: customerContext?.name || contactName || normalizedWaId,
			reason: enrichedState.handoffReason
		});

		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: {
				kind: 'handoff',
				body: handoffReply,
				aiMeta: {
					provider: 'system',
					model: 'human-handoff-router',
					raw: { handoffReason: enrichedState.handoffReason }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState,
				lastUserMessage: messageBody,
				lastAssistantMessage: handoffReply,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision,
				responsePolicy: null,
				commercialPlan: null,
				catalogProducts: [],
				commercialHints: [],
				prompt: null,
				assistantMessage: handoffReply,
				provider: 'system',
				model: 'human-handoff-router',
				aiGuidance,
				liveOrderContext
			}
		};
	}

	const isAiEnabledGlobal =
		String(process.env.AI_AUTOREPLY_ENABLED || 'true').toLowerCase() === 'true';

	const shouldReply =
		isAiEnabledGlobal &&
		queueDecision.aiEnabled &&
		queueDecision.queue === 'AUTO';

	const maxContext = Number(process.env.MAX_CONTEXT_MESSAGES || 12);
	const fullRecentMessages = normalizedMessages.slice(-maxContext);

	let catalogProducts = [];
	let catalogContext = '';
	let commercialHints = [];
	let commercialPlan = null;

	try {
		catalogProducts = await searchCatalogProducts({
			query: messageBody,
			interestedProducts: enrichedState.interestedProducts || [],
			limit: 5
		});

		const catalogStatus = await getCatalogLookupStatus();

		commercialPlan = {
			...resolveCommercialBrainV2({
				intent,
				messageBody,
				currentState: enrichedState,
				recentMessages: fullRecentMessages,
				catalogProducts
			}),
			catalogAvailable: catalogStatus.available !== false,
			catalogStatusReason: catalogStatus.reason || 'ok',
			catalogStatusMessage: catalogStatus.message || null
		};

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
		} else if (intent === 'product' && commercialPlan?.catalogAvailable === false) {
			catalogProducts = [];
			catalogContext = 'Catálogo local no disponible en esta base. No hay productos confirmados para ofrecer.';
			commercialPlan = {
				...commercialPlan,
				bestOffer: null,
				fallbackOffer: null,
				offerOptions: [],
				requestedOfferAvailable: null,
				shareLinkNow: false,
				repeatPriceNow: false,
				recommendedAction: 'catalog_unavailable_clarify_need'
			};
			commercialHints = [
				'El catálogo local no está disponible en esta base.',
				'No inventes productos, promos, precios ni links.',
				'Pedí una aclaración corta o ofrecé pasar con una asesora.'
			];
		} else {
			catalogContext = buildCatalogContext(catalogProducts, commercialPlan);
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
		if (commercialPlan?.categoryLocked && commercialPlan?.productFamilyLabel) {
			commercialHints.push(`No cambies de familia: seguí en ${commercialPlan.productFamilyLabel}.`);
		}
		if (commercialPlan?.excludedKeywords?.length) {
			commercialHints.push(`No vuelvas a ofrecer: ${commercialPlan.excludedKeywords.join(', ')}.`);
		}
		if (commercialPlan?.requestedOfferType && commercialPlan?.requestedOfferAvailable === false && commercialPlan?.fallbackOffer?.name) {
			commercialHints.push(`La ${commercialPlan.requestedOfferType} exacta no apareció. Decilo claro y ofrecé ${commercialPlan.fallbackOffer.name} sin salir de la misma familia.`);
		}
		commercialHints.push('Bajá el tono celebratorio y soná más natural.');

		nextStatePayload = {
			...nextStatePayload,
			currentProductFocus: commercialPlan?.productFocusLabel || commercialPlan?.productFocus || nextStatePayload.currentProductFocus || null,
			currentProductFamily: commercialPlan?.productFamily || nextStatePayload.currentProductFamily || null,
			requestedOfferType: commercialPlan?.requestedOfferType || nextStatePayload.requestedOfferType || null,
			excludedProductKeywords: commercialPlan?.excludedKeywords?.length
				? commercialPlan.excludedKeywords
				: nextStatePayload.excludedProductKeywords || [],
			categoryLocked:
				typeof commercialPlan?.categoryLocked === 'boolean'
					? commercialPlan.categoryLocked
					: nextStatePayload.categoryLocked || false,
			salesStage: commercialPlan?.stage || nextStatePayload.salesStage || null,
			shownOffers: commercialPlan?.bestOffer?.offerLabel
				? [...new Set([...(Array.isArray(nextStatePayload.shownOffers) ? nextStatePayload.shownOffers : []), commercialPlan.bestOffer.offerLabel])]
				: nextStatePayload.shownOffers || [],
			shownPrices: commercialPlan?.repeatPriceNow && commercialPlan?.bestOffer?.price
				? [...new Set([...(Array.isArray(nextStatePayload.shownPrices) ? nextStatePayload.shownPrices : []), `${commercialPlan.bestOffer.name}::${commercialPlan.bestOffer.price}`])]
				: nextStatePayload.shownPrices || [],
			sharedLinks: commercialPlan?.shareLinkNow && commercialPlan?.bestOffer?.productUrl
				? [...new Set([...(Array.isArray(nextStatePayload.sharedLinks) ? nextStatePayload.sharedLinks : []), commercialPlan.bestOffer.productUrl])]
				: nextStatePayload.sharedLinks || [],
			lastRecommendedProduct: commercialPlan?.bestOffer?.name || nextStatePayload.lastRecommendedProduct || null,
			lastRecommendedOffer: commercialPlan?.bestOffer?.offerLabel || nextStatePayload.lastRecommendedOffer || null,
			buyingIntentLevel: commercialPlan?.buyingIntentLevel || nextStatePayload.buyingIntentLevel || null,
			commercialSummary: buildConversationSummary({
				intent,
				enrichedState: { ...enrichedState, currentProductFocus: commercialPlan?.productFocusLabel || commercialPlan?.productFocus || nextStatePayload.currentProductFocus || null },
				lastUserMessage: messageBody,
				lastAssistantMessage: '',
				liveOrderContext,
				commercialPlan
			})
		};

		enrichedState = {
			...enrichedState,
			...nextStatePayload
		};
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
	let prompt = null;
	let postReplyHandoff = false;

	if (!shouldReply) {
		return {
			intent,
			queueDecision,
			nextStatePayload,
			enrichedState,
			outbound: null,
			lastSummary: currentConversation?.lastSummary || null,
			trace: {
				intent,
				queueDecision,
				responsePolicy,
				commercialPlan,
				catalogProducts,
				commercialHints,
				prompt: null,
				assistantMessage: null,
				provider: null,
				model: null,
				aiGuidance,
				liveOrderContext,
				shouldReply: false
			}
		};
	}

	if (!finalReply && !responsePolicy.useAI) {
		if (intent === 'order_status' && liveOrderContext) {
			finalReply = buildFixedOrderReply(liveOrderContext);
		} else {
			finalReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
			});
		}
	}

	if (!finalReply) {
		prompt = buildPrompt({
			businessName,
			contactName: customerContext?.name || contactName || normalizedWaId,
			recentMessages: fullRecentMessages,
			conversationSummary: currentConversation?.lastSummary || '',
			customerContext,
			conversationState: enrichedState,
			liveOrderContext,
			catalogProducts,
			catalogContext,
			commercialHints,
			commercialPlan,
			responsePolicy
		});

		try {
			const aiResult = await runAssistantReply({
				businessName,
				contactName: customerContext?.name || contactName || normalizedWaId,
				recentMessages: fullRecentMessages,
				conversationSummary: currentConversation?.lastSummary || '',
				customerContext,
				conversationState: enrichedState,
				liveOrderContext,
				catalogProducts,
				catalogContext,
				commercialHints,
				commercialPlan,
				responsePolicy
			});

			const fallbackReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
			});

			const audited = auditAssistantReply({
				text: aiResult?.text || '',
				responsePolicy,
				liveOrderContext,
				fallbackReply,
				commercialPlan,
				recentMessages: fullRecentMessages,
				contactName: customerContext?.name || contactName || normalizedWaId,
				businessName,
				agentName: process.env.BUSINESS_AGENT_NAME || 'Sofi'
			});

			finalReply = audited.finalText;
			aiMeta = aiResult;
			postReplyHandoff = audited.triggerHumanHandoff;
		} catch (error) {
			console.error('Error en flujo de respuesta automática:', error);
			finalReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
			});
			aiMeta = {
				provider: 'fallback',
				model: 'local-fallback',
				usage: null,
				raw: {
					error: error.message
				}
			};
		}
	}

	const finalSummary = buildConversationSummary({
		intent,
		enrichedState,
		lastUserMessage: messageBody,
		lastAssistantMessage: finalReply,
		liveOrderContext,
		commercialPlan
	});

	return {
		intent,
		queueDecision,
		nextStatePayload,
		enrichedState,
		outbound: finalReply
			? {
				kind: aiMeta?.provider === 'manual' ? 'manual' : 'assistant',
				body: finalReply,
				aiMeta
			}
			: null,
		lastSummary: finalSummary,
		postReplyHandoff,
		trace: {
			intent,
			queueDecision,
			responsePolicy,
			commercialPlan,
			catalogProducts,
			commercialHints,
			prompt,
			assistantMessage: finalReply,
			provider: aiMeta?.provider || null,
			model: aiMeta?.model || null,
			aiGuidance,
			liveOrderContext,
			shouldReply: true
		}
	};
}
