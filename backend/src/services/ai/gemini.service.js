import { getHttpTimeoutMs, withTimeout } from '../../lib/http-timeout.js';
import { logger } from '../../lib/logger.js';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableGeminiError(error) {
	const message = String(error?.message || '').toLowerCase();

	return (
		message.includes('503') ||
		message.includes('unavailable') ||
		message.includes('high demand') ||
		message.includes('overloaded') ||
		message.includes('rate limit') ||
		message.includes('429') ||
		message.includes('timeout') ||
		message.includes('deadline')
	);
}

export async function runGeminiReply(prompt, options = {}) {
	return runGeminiContent(prompt, options);
}

function normalizeGeminiContents(contents) {
	if (typeof contents === 'string') {
		return [{ parts: [{ text: contents }] }];
	}
	if (Array.isArray(contents)) {
		const looksLikeParts = contents.every((item) => item && typeof item === 'object' && !Array.isArray(item) && !item.parts);
		return looksLikeParts ? [{ parts: contents }] : contents;
	}
	if (contents && typeof contents === 'object') {
		return contents.parts ? [contents] : [{ parts: [contents] }];
	}
	return [{ parts: [{ text: String(contents ?? '') }] }];
}

function normalizeGeminiConfig(config = null) {
	if (!config || typeof config !== 'object') return null;
	return {
		...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
		...(config.topP !== undefined ? { topP: config.topP } : {}),
		...(config.topK !== undefined ? { topK: config.topK } : {}),
		...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
		...(config.responseMimeType !== undefined ? { responseMimeType: config.responseMimeType } : {}),
		...(config.responseSchema !== undefined ? { responseSchema: config.responseSchema } : {}),
	};
}

function getGeminiText(response = {}) {
	if (typeof response.text === 'string') return response.text;
	return (response.candidates || [])
		.flatMap((candidate) => candidate?.content?.parts || [])
		.map((part) => part?.text || '')
		.join('')
		.trim();
}

export async function runGeminiContent(contents, options = {}) {
	const apiKey = process.env.GEMINI_API_KEY;
	const modelName = options.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
	const maxRetries = Number(process.env.GEMINI_MAX_RETRIES || 2);
	const timeoutMs = getHttpTimeoutMs('AI_PROVIDER_TIMEOUT_MS', 30000);

	if (!apiKey) {
		throw new Error("Falta GEMINI_API_KEY en el archivo .env");
	}

	let lastError = null;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			const url = new URL(
				`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`
			);
			url.searchParams.set('key', apiKey);
			const generationConfig = normalizeGeminiConfig(options.config);
			const response = await withTimeout(
				fetch(url, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						contents: normalizeGeminiContents(contents),
						...(generationConfig ? { generationConfig } : {}),
					}),
				}),
				timeoutMs,
				`Gemini timeout after ${timeoutMs}ms`
			);

			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				throw new Error(`Gemini respondio ${response.status}: ${payload?.error?.message || response.statusText}`);
			}

			return {
				provider: "gemini",
				model: modelName,
				text: getGeminiText(payload),
				usage: {
					inputTokens: payload?.usageMetadata?.promptTokenCount || 0,
					outputTokens: payload?.usageMetadata?.candidatesTokenCount || 0,
					totalTokens: payload?.usageMetadata?.totalTokenCount || 0,
				},
				raw: payload,
			};
		} catch (error) {
			lastError = error;
			logger.warn('ai.gemini_attempt_failed', {
				attempt,
				model: modelName,
				error,
			});

			if (!isRetryableGeminiError(error) || attempt > maxRetries) {
				break;
			}

			await sleep(700 * attempt);
		}
	}

	throw lastError;
}
