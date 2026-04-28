import { runGeminiReply, isRetryableGeminiError } from './gemini.service.js';
import { runOpenAIReply } from './openai.service.js';
import { buildPrompt } from '../common/prompt-builder.js';

function buildProviderChain() {
	const preferred = String(process.env.AI_PROVIDER || 'gemini').toLowerCase();
	const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
	const hasGemini = Boolean(process.env.GEMINI_API_KEY);

	const chain = [];

	if (preferred === 'openai') {
		if (hasOpenAI) chain.push('openai');
		if (hasGemini) chain.push('gemini');
	} else {
		if (hasGemini) chain.push('gemini');
		if (hasOpenAI) chain.push('openai');
	}

	return [...new Set(chain)];
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
	menuAssistantContext = null
}) {
	const prompt = buildPrompt({
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
		menuAssistantContext
	});

	const providers = buildProviderChain();
	let lastError = null;

	for (const provider of providers) {
		try {
			if (provider === 'openai') {
				return await runOpenAIReply(prompt);
			}

			if (provider === 'gemini') {
				return await runGeminiReply(prompt);
			}
		} catch (error) {
			lastError = error;
			console.error(`[AI] Falló proveedor ${provider}:`, error.message);

			if (provider === 'gemini' && !isRetryableGeminiError(error)) {
				break;
			}
		}
	}

	throw lastError || new Error('No se pudo generar respuesta con ningún proveedor.');
}
