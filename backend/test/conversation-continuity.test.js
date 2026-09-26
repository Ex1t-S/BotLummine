import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	buildContinuityRecoveryReply,
	findRepeatedAssistantReply,
	isRepeatedUserMessage,
	responseSimilarity,
} from '../src/services/conversation/continuity.service.js';
import { auditAssistantReply } from '../src/services/conversation/conversation-helpers.service.js';
import { looksLikeCustomerFrustration } from '../src/services/conversation/conversation-signals.service.js';

test('response similarity ignores accents, urls and filler words', () => {
	assert.ok(responseSimilarity('Perfecto, acá tenés el link https://shop.test/item', 'aca tenes el link https://shop.test/other') > 0.7);
	assert.ok(responseSimilarity('El envío sale mañana', 'El envio sale mañana') > 0.7);
});

test('a repeated customer question is allowed to receive the same answer', () => {
	const recentMessages = [
		{ role: 'user', text: '¿Cuánto sale?' },
		{ role: 'assistant', text: 'Sale $10.000.' },
		{ role: 'user', text: 'Cuanto sale' },
	];
	assert.equal(isRepeatedUserMessage({ recentMessages, latestUserMessage: 'Cuanto sale' }), true);
	assert.equal(findRepeatedAssistantReply({ text: 'Sale $10.000.', recentMessages, latestUserMessage: 'Cuanto sale' }).repeated, false);
});

test('an assistant response is recovered when it repeats after a new customer turn', () => {
	const recentMessages = [
		{ role: 'user', text: '¿Tenés el body negro?' },
		{ role: 'assistant', text: 'Sí, tenemos el body negro. ¿Querés que te pase el link?' },
		{ role: 'user', text: '¿Y en talle M?' },
	];
	const result = auditAssistantReply({
		text: 'Sí, tenemos el body negro. ¿Querés que te pase el link?',
		fallbackReply: 'Decime qué talle usás y lo reviso.',
		latestUserMessage: '¿Y en talle M?',
		recentMessages,
		responsePolicy: { action: 'size_help', tone: 'amigable_directo' },
		commercialPlan: {},
		liveOrderContext: null,
	});
	assert.equal(result.repetitionDetected, true);
	assert.equal(result.continuityRecovery, true);
	assert.equal(result.finalText, 'Decime qué talle usás y lo reviso.');
});

test('continuity recovery keeps the next action concrete', () => {
	assert.match(buildContinuityRecoveryReply({ responsePolicy: { action: 'shipping_guidance' } }), /localidad|código postal/i);
	assert.match(buildContinuityRecoveryReply({ responsePolicy: { action: 'payment_guidance' } }), /transferencia|tarjeta/i);
});

test('frustration language catches repetition complaints and routes them to a person', () => {
	assert.equal(looksLikeCustomerFrustration('Ya te lo dije, me estás preguntando lo mismo'), true);
	assert.equal(looksLikeCustomerFrustration('No me estás leyendo'), true);
});
