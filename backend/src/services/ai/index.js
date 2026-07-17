import { runGeminiReply } from './gemini.service.js';
import { runOpenAIReply } from './openai.service.js';
import { compilePrompt } from '../common/prompt-builder.js';
import { logger } from '../../lib/logger.js';

export const AI_PROVIDER_ERROR = Object.freeze({
	SAFETY_BLOCK: 'SAFETY_BLOCK',
	AUTH_ERROR: 'AUTH_ERROR',
	RATE_LIMIT: 'RATE_LIMIT',
	TIMEOUT: 'TIMEOUT',
	SERVER_ERROR: 'SERVER_ERROR',
	BAD_REQUEST: 'BAD_REQUEST',
	MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
	INVALID_OUTPUT: 'INVALID_OUTPUT',
	UNKNOWN: 'UNKNOWN',
});

export function classifyAiProviderError(error) {
	const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
	const message = String(error?.message || '').toLowerCase();

	if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|authentication|credencial/.test(message)) {
		return AI_PROVIDER_ERROR.AUTH_ERROR;
	}
	if (status === 429 || /rate.?limit|quota|too many requests/.test(message)) {
		return AI_PROVIDER_ERROR.RATE_LIMIT;
	}
	if (/timeout|timed out|deadline|aborterror|etimedout/.test(message)) {
		return AI_PROVIDER_ERROR.TIMEOUT;
	}
	if (/safety|blocked|content policy|finishreason.*safety/.test(message)) {
		return AI_PROVIDER_ERROR.SAFETY_BLOCK;
	}
	if (status === 404 || /model.*(not found|unavailable)|unavailable model/.test(message)) {
		return AI_PROVIDER_ERROR.MODEL_UNAVAILABLE;
	}
	if (status >= 500 || /overloaded|high demand|service unavailable|internal server error/.test(message)) {
		return AI_PROVIDER_ERROR.SERVER_ERROR;
	}
	if (/sin texto util|empty output|invalid output|schema/.test(message)) {
		return AI_PROVIDER_ERROR.INVALID_OUTPUT;
	}
	if (status >= 400 && status < 500) {
		return AI_PROVIDER_ERROR.BAD_REQUEST;
	}

	return AI_PROVIDER_ERROR.UNKNOWN;
}

export function resolveProviderChain({ preferred = 'gemini', hasOpenAI = false, hasGemini = false } = {}) {
	const normalizedPreferred = String(preferred || 'gemini').toLowerCase();
	const chain = [];

	if (normalizedPreferred === 'openai') {
		if (hasOpenAI) chain.push('openai');
		if (hasGemini) chain.push('gemini');
	} else {
		if (hasGemini) chain.push('gemini');
		if (hasOpenAI) chain.push('openai');
	}

	return [...new Set(chain)];
}

function buildProviderChain() {
	return resolveProviderChain({
		preferred: process.env.AI_PROVIDER || 'gemini',
		hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
		hasGemini: Boolean(process.env.GEMINI_API_KEY),
	});
}

const defaultProviderRunners = Object.freeze({
	gemini: runGeminiReply,
	openai: runOpenAIReply,
});

export async function runProviderChain({ providers = [], prompt, providerRunners = defaultProviderRunners } = {}) {
	const providerErrors = [];

	for (const provider of providers) {
		const runner = providerRunners[provider];
		if (typeof runner !== 'function') continue;

		try {
			const result = await runner(prompt);
			return {
				...result,
				providerErrors,
			};
		} catch (error) {
			const classification = classifyAiProviderError(error);
			providerErrors.push({ provider, classification });
			logger.warn('ai.provider_failed', { provider, classification, error });
		}
	}

	const exhaustedError = new Error('No se pudo generar respuesta con ningún proveedor.');
	exhaustedError.code = 'AI_PROVIDER_CHAIN_EXHAUSTED';
	exhaustedError.providerErrors = providerErrors;
	throw exhaustedError;
}

export async function runAssistantReply({
	businessName,
	workspaceConfig = null,
	contactName,
	recentMessages,
	conversationSummary = '',
	customerContext = {},
	conversationState = {},
	liveOrderContext = null,
	catalogProducts = [],
	catalogContext = '',
	commercialHints = [],
	commercialPlan = {},
	responsePolicy = {},
	menuAssistantContext = null,
	campaignAssistantContext = null,
	compiledPrompt = null,
}) {
	const promptArtifact = compiledPrompt?.text
		? compiledPrompt
		: compilePrompt({
			businessName,
			workspaceConfig,
			contactName,
			recentMessages,
			conversationSummary,
			customerContext,
			conversationState,
			liveOrderContext,
			catalogProducts,
			catalogContext,
			commercialHints,
			commercialPlan,
			responsePolicy,
			menuAssistantContext,
			campaignAssistantContext,
		});

	const result = await runProviderChain({
		providers: buildProviderChain(),
		prompt: promptArtifact.text,
	});

	return {
		...result,
		promptVersion: promptArtifact.promptVersion,
		promptHash: promptArtifact.promptHash,
		factsUsed: promptArtifact.factsUsed,
	};
}
