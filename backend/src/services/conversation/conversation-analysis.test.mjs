import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeConversationTurn } from './conversation-analysis.service.js';
import { resolveReplyGate } from './conversation-helpers.service.js';
import { resolveConversationQueue } from './inbox-routing.service.js';

describe('customer frustration routing', () => {
	it('routes a customer who says the assistant is not listening to a person', () => {
		const messageBody = 'No me estás leyendo: no quiero que ajuste. ¿Puedo cambiarlo si no me queda?';
		const memoryPatch = analyzeConversationTurn({
			messageBody,
			intent: 'return_exchange',
		});
		const queue = resolveConversationQueue({
			currentConversation: { queue: 'AUTO', aiEnabled: true },
			memoryPatch,
			detectedPaymentProof: false,
		});

		assert.equal(memoryPatch.customerMood, 'molesta');
		assert.equal(memoryPatch.needsHuman, true);
		assert.equal(memoryPatch.handoffReason, 'customer_frustration');
		assert.deepEqual(queue, { queue: 'HUMAN', aiEnabled: false });

		const replyGate = resolveReplyGate({
			messageBody,
			intent: 'return_exchange',
			campaignAssistantContext: { category: 'cart_recovery' },
		});
		assert.equal(replyGate.action, 'fixed_reply');
		assert.equal(replyGate.queue, 'HUMAN');
		assert.equal(replyGate.statePatch.handoffReason, 'customer_frustration');
	});

	it('routes repeated-question complaints to a person', () => {
		const memoryPatch = analyzeConversationTurn({
			messageBody: 'Ya te lo dije, me estás preguntando lo mismo',
			intent: 'general',
		});

		assert.equal(memoryPatch.customerMood, 'molesta');
		assert.equal(memoryPatch.needsHuman, true);
		assert.equal(memoryPatch.handoffReason, 'customer_frustration');

		const isolatedComplaint = analyzeConversationTurn({
			messageBody: 'Me estás preguntando lo mismo',
			intent: 'general',
		});
		assert.equal(isolatedComplaint.needsHuman, true);
	});

	it('does not treat a polite size or exchange concern as frustration', () => {
		const messageBody = 'Uso M y no quiero que ajuste mucho. ¿Puedo cambiarlo si no me queda?';
		const memoryPatch = analyzeConversationTurn({
			messageBody,
			intent: 'return_exchange',
		});

		assert.equal(memoryPatch.needsHuman, false);
		assert.notEqual(memoryPatch.customerMood, 'molesta');
	});
});
