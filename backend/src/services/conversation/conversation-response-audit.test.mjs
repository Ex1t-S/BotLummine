import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	auditAssistantReply,
	buildAiFailureFallback,
	buildFallbackOrderAwareReply,
} from './conversation-helpers.service.js';

describe('assistant response relevance safeguards', () => {
	it('replaces a generic greeting when the customer already asked about a product', () => {
		const result = auditAssistantReply({
			text: 'Hola, soy Sofi. ¿En qué puedo ayudarte?',
			fallbackReply: 'Te cuento sobre el body que buscás y te paso una opción confirmada.',
			detectedIntent: 'product',
			latestUserMessage: 'Hola, estoy buscando un body para usar debajo de un vestido.',
		});

		assert.equal(result.finalText, 'Te cuento sobre el body que buscás y te paso una opción confirmada.');
		assert.equal(result.triggerHumanHandoff, false);
	});

	it('hands off when a return or exchange question receives an unrelated sales reply', () => {
		const result = auditAssistantReply({
			text: 'El pack de invierno está en promo. ¿Querés que te pase el link?',
			fallbackReply: 'Contame un poco más y te ayudo.',
			detectedIntent: 'return_exchange',
			latestUserMessage: '¿Puedo cambiarlo si no me queda?',
		});

		assert.match(result.finalText, /asesora|persona del equipo/i);
		assert.equal(result.triggerHumanHandoff, true);
		assert.equal(result.handoffReason, 'unanswered_return_exchange');
	});

	it('keeps a relevant exchange-policy answer without forcing a handoff', () => {
		const result = auditAssistantReply({
			text: 'La política de cambios depende del estado del producto; te explico los pasos para gestionarlo.',
			fallbackReply: 'Contame un poco más y te ayudo.',
			detectedIntent: 'return_exchange',
			latestUserMessage: '¿Puedo cambiarlo si no me queda?',
		});

		assert.equal(result.triggerHumanHandoff, false);
		assert.match(result.finalText, /cambios/i);
	});

	it('replaces an unsupported product comfort claim with a catalog-grounded answer', () => {
		const result = auditAssistantReply({
			text: 'Te recomiendo Body Comfort: es ideal para usar todo el día y modela suavemente.',
			fallbackReply: 'Contame qué producto buscás y te oriento.',
			detectedIntent: 'product',
			latestUserMessage: 'Busco algo cómodo para usar todo el día, que modele suave.',
			commercialPlan: { bestOffer: { name: 'Body Comfort' } },
			catalogProducts: [{ name: 'Body Comfort', shortDescription: 'Colores negro y beige. Talles S, M y L.' }],
		});

		assert.match(result.finalText, /no tengo confirmados datos sobre comodidad o calce/i);
		assert.doesNotMatch(result.finalText, /ideal para usar todo el d[ií]a|modela suavemente/i);
		assert.equal(result.triggerHumanHandoff, false);
		assert.deepEqual(result.auditFlags, ['unverified_catalog_claim:all_day_use', 'unverified_catalog_claim:modeling', 'unverified_catalog_claim:softness']);
	});

	it('allows a product feature when the selected product description confirms it', () => {
		const text = 'Body Comfort está descrito como cómodo para uso diario y con modelado suave.';
		const result = auditAssistantReply({
			text,
			fallbackReply: 'Contame qué producto buscás y te oriento.',
			detectedIntent: 'product',
			commercialPlan: { bestOffer: { name: 'Body Comfort' } },
			catalogProducts: [{
				name: 'Body Comfort',
				shortDescription: 'Diseñado para comodidad de uso diario con modelado suave.',
			}],
		});

		assert.equal(result.finalText, text);
		assert.deepEqual(result.auditFlags, []);
	});

	it('replaces size advice based only on the customer size and available variants', () => {
		const result = auditAssistantReply({
			text: 'Como usás M, te sugiero mantener ese talle para que te resulte cómodo.',
			fallbackReply: 'Tomo el talle M como referencia. Para recomendarte bien necesito la guía de medidas del modelo; no quiero asegurarte el calce sólo por la letra.',
			detectedIntent: 'size_help',
			latestUserMessage: 'Uso talle M y no quiero que me ajuste mucho. ¿Qué talle me recomendás?',
			catalogProducts: [{ name: 'Body Air', sizes: ['S', 'M', 'L'] }],
		});

		assert.match(result.finalText, /gu[ií]a de medidas/i);
		assert.doesNotMatch(result.finalText, /te sugiero mantener ese talle/i);
		assert.deepEqual(result.auditFlags, ['unsupported_size_recommendation']);
	});

	it('keeps a cautious size reply that does not recommend a size', () => {
		const text = 'No tengo una guía de medidas confirmada para ese modelo, así que no quiero recomendarte un talle sin verificarla.';
		const result = auditAssistantReply({ text, fallbackReply: 'Respuesta segura.', detectedIntent: 'size_help' });

		assert.equal(result.finalText, text);
		assert.deepEqual(result.auditFlags, []);
	});

	it('allows a size recommendation when the selected product provides actual measurements', () => {
		const text = 'Con la guía de medidas del Body Air, el talle M coincide con las medidas que pasaste.';
		const result = auditAssistantReply({
			text,
			fallbackReply: 'Respuesta segura.',
			detectedIntent: 'size_help',
			commercialPlan: { bestOffer: { name: 'Body Air' } },
			catalogProducts: [{ name: 'Body Air', sizeGuide: { M: 'busto 92 cm, cintura 80 cm' } }],
		});

		assert.equal(result.finalText, text);
		assert.deepEqual(result.auditFlags, []);
	});

	it('uses a known size without inventing fit or asking for that size again', () => {
		const result = buildAiFailureFallback({
			intent: 'size_help',
			enrichedState: { frequentSize: 'M' },
		});

		assert.match(result, /talle M/i);
		assert.match(result, /guía de medidas/i);
		assert.doesNotMatch(result, /qué talle usás/i);
		assert.doesNotMatch(result, /promo|pack/i);
	});

	it('keeps the size-specific fallback when the conversation came from cart recovery', () => {
		const result = buildFallbackOrderAwareReply({
			intent: 'size_help',
			enrichedState: { frequentSize: 'M' },
			campaignAssistantContext: { category: 'cart_recovery' },
		});

		assert.match(result, /talle M/i);
		assert.doesNotMatch(result, /decime qué duda te frena|promo|pack/i);
	});
});
