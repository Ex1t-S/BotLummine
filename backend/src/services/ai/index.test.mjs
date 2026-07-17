import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	AI_PROVIDER_ERROR,
	classifyAiProviderError,
	resolveProviderChain,
	runProviderChain,
} from './index.js';
import { compilePrompt, PROMPT_VERSION } from '../common/prompt-builder.js';

describe('AI provider routing', () => {
	it('preserves the preferred provider order', () => {
		assert.deepEqual(
			resolveProviderChain({ preferred: 'openai', hasOpenAI: true, hasGemini: true }),
			['openai', 'gemini']
		);
		assert.deepEqual(
			resolveProviderChain({ preferred: 'gemini', hasOpenAI: true, hasGemini: true }),
			['gemini', 'openai']
		);
	});

	it('classifies provider failures with the shared taxonomy', () => {
		assert.equal(classifyAiProviderError({ status: 401 }), AI_PROVIDER_ERROR.AUTH_ERROR);
		assert.equal(classifyAiProviderError({ status: 429 }), AI_PROVIDER_ERROR.RATE_LIMIT);
		assert.equal(classifyAiProviderError(new Error('request timeout')), AI_PROVIDER_ERROR.TIMEOUT);
		assert.equal(classifyAiProviderError({ status: 503 }), AI_PROVIDER_ERROR.SERVER_ERROR);
		assert.equal(classifyAiProviderError(new Error('Gemini respondio sin texto util')), AI_PROVIDER_ERROR.INVALID_OUTPUT);
	});

	it('continues to the next provider after a non-retryable provider error', async () => {
		const calls = [];
		const result = await runProviderChain({
			providers: ['gemini', 'openai'],
			prompt: 'compiled-once',
			providerRunners: {
				gemini: async (prompt) => {
					calls.push(['gemini', prompt]);
					const error = new Error('bad request');
					error.status = 400;
					throw error;
				},
				openai: async (prompt) => {
					calls.push(['openai', prompt]);
					return { provider: 'openai', model: 'test', text: 'ok' };
				},
			},
		});

		assert.equal(result.text, 'ok');
		assert.deepEqual(calls, [
			['gemini', 'compiled-once'],
			['openai', 'compiled-once'],
		]);
		assert.deepEqual(result.providerErrors, [
			{ provider: 'gemini', classification: AI_PROVIDER_ERROR.BAD_REQUEST },
		]);
	});

	it('continues to the next provider after an invalid empty output', async () => {
		const result = await runProviderChain({
			providers: ['gemini', 'openai'],
			prompt: 'compiled-once',
			providerRunners: {
				gemini: async () => ({ provider: 'gemini', model: 'test', text: '   ' }),
				openai: async () => ({ provider: 'openai', model: 'test', text: 'fallback válido' }),
			},
		});

		assert.equal(result.text, 'fallback válido');
		assert.equal(result.output.reply, 'fallback válido');
		assert.deepEqual(result.providerErrors, [
			{ provider: 'gemini', classification: AI_PROVIDER_ERROR.INVALID_OUTPUT },
		]);
	});
});

describe('canonical prompt compiler', () => {
	const input = {
		businessName: 'Marca sintética',
		contactName: 'Cliente Demo',
		recentMessages: [{ role: 'user', text: '¿Cuánto cuesta?' }],
		catalogProducts: [{ name: 'Producto verificado', price: '$100' }],
	};

	it('returns a deterministic versioned artifact without recompiling in providers', () => {
		const first = compilePrompt(input);
		const second = compilePrompt(input);

		assert.equal(first.promptVersion, PROMPT_VERSION);
		assert.equal(first.promptHash, second.promptHash);
		assert.equal(first.promptHash.length, 64);
		assert.ok(first.text.includes('Marca sintética'));
		assert.deepEqual(first.factsUsed, ['catalog_products:1']);
		assert.ok(Object.isFrozen(first));
	});

	it('changes the hash when the current message changes', () => {
		const first = compilePrompt(input);
		const changed = compilePrompt({
			...input,
			recentMessages: [{ role: 'user', text: '¿Hay stock?' }],
		});

		assert.notEqual(first.promptHash, changed.promptHash);
	});
});
