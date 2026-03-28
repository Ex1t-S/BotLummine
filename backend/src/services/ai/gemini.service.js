import { GoogleGenAI } from "@google/genai";

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
	const apiKey = process.env.GEMINI_API_KEY;
	const modelName = options.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
	const maxRetries = Number(process.env.GEMINI_MAX_RETRIES || 2);

	if (!apiKey) {
		throw new Error("Falta GEMINI_API_KEY en el archivo .env");
	}

	const ai = new GoogleGenAI({ apiKey });
	let lastError = null;

	for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
		try {
			const response = await ai.models.generateContent({
				model: modelName,
				contents: prompt,
			});

			return {
				provider: "gemini",
				model: modelName,
				text: response.text || "",
				usage: {
					inputTokens: response.usageMetadata?.promptTokenCount || 0,
					outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
					totalTokens: response.usageMetadata?.totalTokenCount || 0,
				},
				raw: response,
			};
		} catch (error) {
			lastError = error;
			console.error("--- ERROR EN GEMINI SERVICE ---");
			console.error(`Intento ${attempt}:`, error.message);

			if (!isRetryableGeminiError(error) || attempt > maxRetries) {
				break;
			}

			await sleep(700 * attempt);
		}
	}

	throw lastError;
}