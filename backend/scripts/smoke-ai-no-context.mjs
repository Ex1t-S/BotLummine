import 'dotenv/config';

import { runGeminiReply } from '../src/services/ai/gemini.service.js';
import { classifyAiProviderError } from '../src/services/ai/index.js';

if (!(process.env.GEMINI_API_KEY || process.env.gemini_api_key)) {
	console.error('No se puede probar Gemini: falta GEMINI_API_KEY en el entorno o backend/.env.');
	process.exit(2);
}

const startedAt = Date.now();

try {
	const result = await runGeminiReply('Responde únicamente con la palabra OK.');
	console.log(JSON.stringify({
		ok: Boolean(String(result?.text || '').trim()),
		provider: result?.provider || 'gemini',
		model: result?.model || null,
		elapsedMs: Date.now() - startedAt,
		usage: result?.usage || null,
	}, null, 2));
} catch (error) {
	console.error(JSON.stringify({
		ok: false,
		provider: 'gemini',
		model: process.env.GEMINI_MODEL || process.env.MODEL_NAME || null,
		classification: classifyAiProviderError(error),
		status: error?.status || error?.statusCode || null,
		elapsedMs: Date.now() - startedAt,
	}, null, 2));
	process.exitCode = 1;
}
