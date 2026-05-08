import 'dotenv/config';

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { runAssistantReply } from '../src/services/ai/index.js';
import { buildPrompt } from '../src/services/common/prompt-builder.js';

function readFlag(name, fallback = '') {
	const prefix = `--${name}=`;
	const match = process.argv.find((arg) => arg.startsWith(prefix));
	if (!match) return fallback;
	return String(match.slice(prefix.length)).trim();
}

function hasFlag(name) {
	return process.argv.includes(`--${name}`);
}

function usage() {
	console.log(`
Uso:
  node scripts/test-ai-no-context.mjs --message="Hola, que promos tienen?"
  node scripts/test-ai-no-context.mjs --chat

Opcionales:
  --brand="PampaStore"
  --agent="Sofi"
  --tone="cercana, clara y resolutiva"
  --contact="Carla"
  --prompt-only

Ejemplos:
  node scripts/test-ai-no-context.mjs --message="Hola"
  node scripts/test-ai-no-context.mjs --message="Busco un body negro" --brand="PampaStore"
  node scripts/test-ai-no-context.mjs --chat --brand="PampaStore"
  node scripts/test-ai-no-context.mjs --message="Que promo tienen?" --prompt-only
`.trim());
}

function buildCommonInput({
	message,
	businessName,
	agentName,
	tone,
	contactName,
	recentMessages,
}) {
	return {
		businessName,
		workspaceConfig: {
			ai: {
				businessName,
				agentName,
				tone,
				systemPrompt: '',
				businessContext: '',
			},
		},
		contactName,
		recentMessages,
		conversationSummary: '',
		customerContext: {
			name: contactName,
			waId: '5491100000000',
		},
		conversationState: {},
		liveOrderContext: null,
		catalogProducts: [],
		catalogContext: 'Catálogo local no disponible en esta base. No hay productos confirmados para ofrecer.',
		commercialHints: [
			'No inventes productos, promos, precios ni links.',
			'Si falta contexto comercial, respondé corto y pedí una aclaración útil.',
			'No ofrezcas productos de otra marca.',
		],
		commercialPlan: {
			catalogAvailable: false,
			stage: 'DISCOVERY',
			requestedAction: 'GENERAL',
			productFamily: null,
			productFocus: null,
			requestedOfferType: null,
			requestedOfferAvailable: null,
			categoryLocked: false,
			bestOffer: null,
			fallbackOffer: null,
			offerCandidates: [],
			shareLinkNow: false,
			repeatPriceNow: false,
			alreadyShared: {
				sharedLinks: [],
				shownPrices: [],
				shownOffers: [],
			},
			recommendedAction: 'catalog_unavailable_clarify_need',
			greetingOnly: false,
		},
		responsePolicy: {
			action: 'general_help',
			tone: 'amigable_directo',
			maxChars: 220,
			allowHandoffMention: false,
		},
		menuAssistantContext: null,
		_lastMessage: message,
	};
}

async function runInteractiveChat({ businessName, agentName, tone, contactName }) {
	if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
		console.error('No hay OPENAI_API_KEY ni GEMINI_API_KEY en el entorno.');
		process.exit(1);
	}

	const rl = readline.createInterface({ input, output });
	const recentMessages = [];

	console.log(`\nChat sin contexto comercial listo. Marca: ${businessName}. Escribí "salir" para terminar.\n`);

	try {
		while (true) {
			const message = String(await rl.question('Vos: ')).trim();
			if (!message) continue;
			if (['salir', 'exit', 'quit'].includes(message.toLowerCase())) break;

			recentMessages.push({ role: 'user', text: message });

			const commonInput = buildCommonInput({
				message,
				businessName,
				agentName,
				tone,
				contactName,
				recentMessages,
			});

			const reply = await runAssistantReply(commonInput);
			console.log(`IA: ${reply}\n`);

			recentMessages.push({ role: 'assistant', text: reply });
		}
	} finally {
		rl.close();
	}
}

async function main() {
	const message = readFlag('message');
	const chatMode = hasFlag('chat');
	if ((!message && !chatMode) || hasFlag('help')) {
		usage();
		process.exit(message || chatMode ? 0 : 1);
	}

	const businessName = readFlag('brand', 'PampaStore');
	const agentName = readFlag('agent', 'Sofi');
	const tone = readFlag('tone', 'cercana, clara y resolutiva');
	const contactName = readFlag('contact', 'Cliente');
	const promptOnly = hasFlag('prompt-only');

	if (chatMode) {
		await runInteractiveChat({ businessName, agentName, tone, contactName });
		return;
	}

	const commonInput = buildCommonInput({
		message,
		businessName,
		agentName,
		tone,
		contactName,
		recentMessages: [{ role: 'user', text: message }],
	});

	const prompt = buildPrompt(commonInput);

	if (promptOnly) {
		console.log('\n=== PROMPT ===\n');
		console.log(prompt);
		return;
	}

	if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
		console.error('No hay OPENAI_API_KEY ni GEMINI_API_KEY en el entorno.');
		console.error('Usá --prompt-only si querés inspeccionar el prompt sin llamar al modelo.');
		process.exit(1);
	}

	const startedAt = Date.now();
	const reply = await runAssistantReply(commonInput);
	const elapsedMs = Date.now() - startedAt;

	console.log('\n=== INPUT ===\n');
	console.log(message);
	console.log('\n=== REPLY ===\n');
	console.log(reply);
	console.log(`\n=== META ===\nprovider=${process.env.AI_PROVIDER || 'gemini'} elapsedMs=${elapsedMs}`);
}

main().catch((error) => {
	console.error('\n[AI TEST ERROR]');
	console.error(error?.message || error);
	process.exit(1);
});
