import { prisma } from '../../lib/prisma.js';
import { runAssistantReply } from '../ai/index.js';
import { normalizeThreadPhone } from '../../lib/conversation-threads.js';
import { publishInboxEvent } from '../../lib/inbox-events.js';
import {
	detectIntent,
	extractOrderNumber,
	extractStandaloneOrderNumber
} from '../../lib/intent.js';
import {
	analyzeConversationTurn,
	buildHandoffReply
} from './conversation-analysis.service.js';
import {
	searchCatalogProducts,
	buildCatalogContext,
	pickCommercialHints
} from '../catalog/catalog-search.service.js';
import { resolveCommercialBrainV2 } from '../ai/commercial-brain.service.js';
import {
	isPaymentProofMessage,
	buildPaymentReviewAck,
	resolveConversationQueue
} from './inbox-routing.service.js';
import {
	normalizeText,
	buildConversationSummary,
	buildAiFailureFallback,
	buildResponsePolicy,
	auditAssistantReply,
	resolveIntentAction,
	buildStatePayload,
	buildFallbackOrderAwareReply,
} from './conversation-helpers.service.js';
import {
	maybeHandleMenuFlow,
	syncHumanHandoff,
} from './menu-flow.service.js';
import { sendAndPersistOutbound } from './outbound-message.service.js';

export async function getOrCreateConversation({
	waId,
	contactName,
	queue = 'HUMAN',
	aiEnabled = false,
	forceRouting = false
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
						needsHuman: queue === 'HUMAN' || aiEnabled === false,
						menuActive: false,
						menuPath: null
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
						needsHuman: conversation.queue === 'HUMAN' || conversation.aiEnabled === false,
						menuActive: false,
						menuPath: null
					}
				}
			},
			include: { contact: true, state: true }
		});
	}

	if (forceRouting && (conversation.queue !== queue || conversation.aiEnabled !== aiEnabled)) {
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

	publishInboxEvent({
		scope: 'message',
		action: 'inbound-created',
		conversationId: conversation.id,
		queue: conversation.queue,
		direction: 'INBOUND',
		metaMessageId,
		createdAt: new Date().toISOString(),
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

	const effectiveMessageBody = normalizeText(
		menuDecision?.effectiveMessageBody || messageBody
	);
	const summaryUserMessage = normalizeText(
		menuDecision?.summaryUserMessage || effectiveMessageBody || messageBody
	);
	const forceIntent = menuDecision?.forceIntent || null;
	const menuStatePatch = menuDecision?.statePatch || null;

	const intent = forceIntent || detectIntent(effectiveMessageBody, currentState);
	const explicitOrderNumber =
		extractOrderNumber(effectiveMessageBody, currentState) ||
		extractStandaloneOrderNumber(effectiveMessageBody);

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

		const patchedStatePayload = {
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
				lastUserMessage: summaryUserMessage,
				lastAssistantMessage: '',
				liveOrderContext,
				commercialPlan
			})
		};

		Object.assign(nextStatePayload, patchedStatePayload);
		Object.assign(enrichedState, patchedStatePayload);

		await prisma.conversationState.upsert({
			where: { conversationId: freshConversation.id },
			update: patchedStatePayload,
			create: {
				conversationId: freshConversation.id,
				...patchedStatePayload
			}
		});
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
				contactName: freshConversation.contact.name || freshConversation.contact.waId
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

			finalReply = buildFallbackOrderAwareReply({
				intent,
				liveOrderContext,
				enrichedState,
				catalogProducts,
				commercialPlan,
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