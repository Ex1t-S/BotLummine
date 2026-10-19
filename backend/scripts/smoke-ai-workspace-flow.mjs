import 'dotenv/config';

import { runGeminiReply } from '../src/services/ai/gemini.service.js';
import { classifyAiProviderError } from '../src/services/ai/index.js';
import { compilePrompt } from '../src/services/common/prompt-builder.js';

function readFlag(name, fallback) {
	const prefix = `--${name}=`;
	const value = process.argv.find((arg) => arg.startsWith(prefix));
	return value ? value.slice(prefix.length).trim() : fallback;
}

const businessName = readFlag('brand', process.env.AI_TEST_BUSINESS_NAME || 'Tienda de prueba');
const agentName = readFlag('agent', process.env.AI_TEST_AGENT_NAME || 'Asesora de prueba');
const tone = readFlag('tone', process.env.AI_TEST_TONE || 'cercana, clara y profesional');
const message = readFlag('message', 'Hola, ¿me contás cómo puedo pagar?');

const compiledPrompt = compilePrompt({
	businessName,
	workspaceConfig: {
		ai: {
			businessName,
			agentName,
			tone,
			aiProfile: 'GENERIC_ECOMMERCE',
			businessContext: '',
			systemPrompt: '',
			paymentConfig: { transfer: {} },
		},
	},
	contactName: 'Cliente de prueba',
	recentMessages: [{ role: 'user', text: message }],
	commercialHints: ['No inventes precios, promociones ni medios de pago no configurados.'],
});

const requiredPromptValues = [businessName, agentName, tone, message];
const promptContextValid = requiredPromptValues.every((value) => compiledPrompt.text.includes(value));
if (!promptContextValid) {
	console.error('El prompt no conservó todos los datos de marca, tono y mensaje de prueba.');
	process.exit(1);
}

if (!(process.env.GEMINI_API_KEY || process.env.gemini_api_key)) {
	console.error('El contexto de marca se compiló correctamente, pero falta GEMINI_API_KEY para probar Gemini.');
	process.exit(2);
}

const startedAt = Date.now();

try {
	const result = await runGeminiReply(compiledPrompt.text);
	console.log(JSON.stringify({
		ok: Boolean(String(result?.text || '').trim()),
		provider: result?.provider || 'gemini',
		model: result?.model || null,
		promptContextValid,
		promptVersion: compiledPrompt.promptVersion,
		promptHash: compiledPrompt.promptHash,
		elapsedMs: Date.now() - startedAt,
		usage: result?.usage || null,
	}, null, 2));
} catch (error) {
	console.error(JSON.stringify({
		ok: false,
		provider: 'gemini',
		model: process.env.GEMINI_MODEL || process.env.MODEL_NAME || null,
		promptContextValid,
		classification: classifyAiProviderError(error),
		status: error?.status || error?.statusCode || null,
		elapsedMs: Date.now() - startedAt,
	}, null, 2));
	process.exitCode = 1;
}
