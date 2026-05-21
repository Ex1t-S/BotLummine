import { runAssistantReply } from '../ai/index.js';
import { buildPrompt } from '../common/prompt-builder.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import { logger } from '../../lib/logger.js';
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
	PAYMENT_REVIEW_ACK,
	resolveConversationQueue
} from './inbox-routing.service.js';
import {
	classifyInboundAttachment,
	attachmentClassificationLooksLikeReturnEvidence
} from './attachment-classifier.service.js';
import {
	normalizeText,
	createResetConversationState,
	buildConversationSummary,
	buildAiFailureFallback,
	buildCatalogSafetyFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	buildStatePayload,
	normalizeRecentMessage,
	buildFallbackOrderAwareReply,
	shouldForceCatalogSafetyFallback,
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

	const attachmentClassification = await classifyInboundAttachment({
		messageType,
		messageBody,
		rawPayload,
		attachmentMeta,
		currentState,
		recentMessages,
		waId: normalizedWaId,
	});

	const detectedPaymentProof = isPaymentProofMessage({
		messageType,
		body: messageBody,
		rawPayload,
		currentState,
		recentMessages,
		attachmentClassification
	});

	const ambiguousPaymentAttachment = isAmbiguousPaymentAttachment({
		messageType,
		body: messageBody,
		rawPayload,
		currentState,
		recentMessages,
		attachmentClassification
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

	if (
		attachmentClassificationLooksLikeReturnEvidence(attachmentClassification) &&
		(enrichedState?.handoffReason === 'return_exchange' || currentState?.handoffReason === 'return_exchange')
	) {
		const reply =
			'Gracias, ya sumo la foto al caso. Queda derivado para que una asesora lo revise y te responda por aca.';
		return {
			intent,
			queueDecision: {
				queue: 'HUMAN',
				aiEnabled: false,
			},
			nextStatePayload: {
				...nextStatePayload,
				needsHuman: true,
				handoffReason: 'return_exchange',
			},
			enrichedState: {
				...enrichedState,
				needsHuman: true,
				handoffReason: 'return_exchange',
			},
			outbound: {
				kind: 'return_evidence_ack',
				body: reply,
				aiMeta: {
					provider: 'system',
					model: 'return-evidence-router',
					raw: { attachmentClassification }
				}
			},
			lastSummary: buildConversationSummary({
				intent,
				enrichedState: {
					...enrichedState,
					needsHuman: true,
					handoffReason: 'return_exchange',
				},
				lastUserMessage: messageBody,
				lastAssistantMessage: reply,
				liveOrderContext
			}),
			trace: {
				intent,
				queueDecision: {
					queue: 'HUMAN',
					aiEnabled: false,
				},
				attachmentClassification,
				assistantMessage: reply,
				provider: 'system',
				model: 'return-evidence-router',
				aiGuidance,
				liveOrderContext
			}
		};
	}

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
		const ack = PAYMENT_REVIEW_ACK;
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
			limit: 5,
			workspaceId
		});

		const catalogStatus = await getCatalogLookupStatus({ workspaceId });

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
				aiGuidance.hasLocation
					? 'La clienta ya dio ubicacion o codigo postal. No se lo vuelvas a pedir.'
					: 'Si falta ubicacion, pedi zona, localidad o provincia sin cortar el hilo.'
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
		logger.warn('catalog.conversation_turn_lookup_failed', {
			workspaceId,
			conversationId: currentConversation?.id || null,
			error: catalogError,
		});
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

	if (
		!finalReply &&
		shouldForceCatalogSafetyFallback({
			intent,
			messageBody,
			enrichedState,
			catalogProducts,
			commercialPlan,
		})
	) {
		finalReply = buildCatalogSafetyFallback({
			intent,
			messageBody,
			enrichedState,
			commercialPlan,
		});
		aiMeta = {
			provider: 'fallback',
			model: 'catalog-safety-fallback',
			raw: {
				reason: 'no_confirmed_catalog_match',
			},
		};
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
			logger.error('ai.conversation_turn_failed', {
				workspaceId,
				conversationId: currentConversation?.id || null,
				error,
			});
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
