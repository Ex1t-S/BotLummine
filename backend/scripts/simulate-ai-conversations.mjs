import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

import { runAssistantReply } from '../src/services/ai/index.js';
import { detectIntent } from '../src/lib/intent.js';
import {
	auditAssistantReply,
	buildAiFailureFallback,
	buildResponsePolicy,
} from '../src/services/conversation/conversation-helpers.service.js';

const COUNT = Number(readArg('--count', '100'));
const CONCURRENCY = Math.max(1, Math.min(Number(readArg('--concurrency', '4')), 12));
const OUT_DIR = readArg('--outDir', 'scripts/debug-output');
const PROVIDER = readArg('--provider', process.env.AI_PROVIDER || 'gemini');
const MODEL = readArg('--model', process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite');

process.env.AI_PROVIDER = PROVIDER;
process.env.GEMINI_MODEL = MODEL;
process.env.BUSINESS_NAME = process.env.BUSINESS_NAME || 'Lummine';
process.env.BUSINESS_AGENT_NAME = process.env.BUSINESS_AGENT_NAME || 'Sofi';

function readArg(name, fallback = '') {
	const index = process.argv.indexOf(name);
	if (index >= 0 && process.argv[index + 1]) {
		return process.argv[index + 1];
	}
	const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
	return inline ? inline.slice(name.length + 1) : fallback;
}

function pick(list, index) {
	return list[Math.abs(index) % list.length];
}

function normalize(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const catalogProducts = [
	{
		name: 'Calza modeladora Lummine',
		family: 'calzas modeladoras',
		offerType: 'promo',
		price: '$39.990',
		productUrl: 'https://lummine.com.ar/products/calza-modeladora',
		colors: ['negro', 'beige'],
		sizes: ['S/M', 'M/L', 'XL/XXL'],
	},
	{
		name: 'Body modelador',
		family: 'body modelador',
		offerType: 'single',
		price: '$42.990',
		productUrl: 'https://lummine.com.ar/products/body-modelador',
		colors: ['negro', 'blanco', 'beige'],
		sizes: ['S/M', 'M/L', 'XL/XXL'],
	},
	{
		name: 'Pack 3x1 prendas modeladoras',
		family: 'packs modeladores',
		offerType: '3x1',
		price: '$49.990',
		productUrl: 'https://lummine.com.ar/products/pack-3x1',
		colors: ['varios'],
		sizes: ['S/M', 'M/L', 'XL/XXL'],
	},
];

const campaignScenarios = [
	{
		label: 'campaign_promo_why',
		goal: 'responder_consulta_de_promocion',
		userMessages: ['Hola xq el mensaje?', 'Por que me escriben?', 'De donde sacaron mi numero?', 'Que es esto?', 'Hola, que promo es?'],
		summary:
			'Ultimo contacto: campana promocional. Plantilla enviada: promo_calzas_lummine_v2. Mensaje enviado: Te compartimos una de las calzas mas elegidas del momento. Continuar ese tema sin abrir menu.',
		hints: [
			'La clienta esta respondiendo una campana reciente: no abras el menu principal.',
			'No digas que recibiste una consulta si la charla empezo por campana: deci que le escribimos para compartir la promo.',
			'Si viene por promo, explica por que se envio y ofrece ayuda sobre producto, talle, stock o compra.',
		],
	},
	{
		label: 'campaign_promo_bought',
		goal: 'responder_consulta_de_promocion',
		userMessages: ['Hoy las compre!', 'Ya compre gracias', 'Ya hice la compra', 'Ayer compre dos', 'Ya esta pago'],
		summary:
			'Ultimo contacto: campana promocional. Plantilla enviada: promo_calzas_lummine_v2. Mensaje enviado: promo de calzas modeladoras.',
		hints: [
			'No intentes vender de nuevo si ya compro; responde breve y ofrece ayudar con pedido o comprobante si lo necesita.',
			'No suenes celebratoria ni ceremonial.',
		],
	},
	{
		label: 'campaign_pending_payment',
		goal: 'resolver_pago_pendiente',
		userMessages: ['Hola', 'Ya pague por transferencia', 'Te mando comprobante?', 'No me toma la tarjeta', 'Cual era mi compra perdon?'],
		summary:
			'Ultimo contacto: campana de pago pendiente. Plantilla enviada: recuperacion_carritos. Mensaje enviado: pedido con PAGO PENDIENTE y cupon activo. Continuar sin menu.',
		hints: [
			'Si viene por pago pendiente, ayuda a completar el pago o confirmar comprobante sin vender otra promo.',
			'Si solo saluda, contesta que le escribias por el pago pendiente y ofrece ayudar a finalizar o revisar comprobante.',
		],
	},
	{
		label: 'campaign_cart',
		goal: 'retomar_compra_carrito',
		userMessages: [
			'Tengo miedo que no me quede',
			'Quiero envio a sucursal',
			'No me deja pagar en cuotas',
			'Me pasas el link de nuevo?',
			'Hay talle xl?',
		],
		summary:
			'Ultimo contacto: campana de carrito abandonado. Producto foco: Calza modeladora anticelulitis 2x1. Link pendiente: https://lummine.com.ar/checkout/abc. Continuar sin menu.',
		hints: [
			'Si viene por carrito abandonado, resolvi la objecion concreta para que pueda finalizar la compra.',
			'Si pregunta por talle, envio o cuotas, contesta eso y conserva el link pendiente cuando exista.',
			'Si tiene miedo por el talle, pedile una referencia concreta de talle/medidas y tranquiliza sin derivar.',
		],
	},
];

const normalScenarios = [
	{
		label: 'normal_greeting',
		userMessages: ['Hola', 'Buenas', 'Hola queria consultar', 'Holaa', 'Buen dia'],
		state: {},
		hints: ['Respondé breve y natural, preguntando qué está buscando.'],
	},
	{
		label: 'normal_product',
		userMessages: ['Tenes body modelador negro?', 'Quiero ver calzas', 'Me interesa el 3x1', 'Hay fajas?', 'Busco algo para modelar cintura'],
		state: { interestedProducts: ['prendas modeladoras'] },
		hints: ['Guiá hacia una opción principal y pedí talle/color si falta.'],
	},
	{
		label: 'normal_size',
		userMessages: ['Soy talle M, cual me va?', 'Uso 110 de corpiño', 'Mido 1.60 y peso 95', 'Que talle me recomendas?', 'Hay XL/XXL?'],
		state: { currentProductFocus: 'Calza modeladora Lummine', interestedProducts: ['calza modeladora'] },
		hints: ['Orientá por talle sin prometer calce perfecto.'],
	},
	{
		label: 'normal_shipping',
		userMessages: ['Hacen envios a Cordoba?', 'Cuanto tarda el envio?', 'Puedo retirar por sucursal?', 'Envian por correo argentino?', 'Llega a Neuquen?'],
		state: { currentProductFocus: 'Calza modeladora Lummine' },
		hints: ['Respondé envío sin cambiar a otra promo.'],
	},
	{
		label: 'normal_payment',
		userMessages: ['Aceptan transferencia?', 'Tienen cuotas?', 'Me pasas alias?', 'Puedo pagar mercado pago?', 'Como hago el pago?'],
		state: { currentProductFocus: 'Calza modeladora Lummine' },
		hints: ['Respondé pago de forma concreta.'],
	},
	{
		label: 'normal_order_status',
		userMessages: ['Quiero saber donde esta mi pedido', 'Mi pedido es 22997', 'No me llego el seguimiento', 'Estado del pedido #12345', 'Cuando llega mi compra?'],
		state: { lastIntent: 'order_status' },
		hints: ['No inventes tracking si no hay pedido real cargado.'],
	},
	{
		label: 'normal_complaint',
		userMessages: ['Me llego mal el pedido', 'Nadie me responde', 'Estoy disconforme', 'Vino fallado', 'Quiero reclamar'],
		state: {},
		hints: ['Bajá tensión y ofrecé revisión humana cuando corresponda.'],
	},
	{
		label: 'normal_handoff',
		userMessages: ['Quiero hablar con una persona', 'Pasame con una asesora', 'Humano por favor', 'No quiero bot', 'Necesito que me atienda alguien'],
		state: {},
		hints: ['Si pide persona, no sigas vendiendo.'],
	},
];

function buildCase(index) {
	const useCampaign = index % 2 === 0;
	const scenario = useCampaign
		? pick(campaignScenarios, Math.floor(index / 2))
		: pick(normalScenarios, Math.floor(index / 2));
	const userText = pick(scenario.userMessages, index + Math.floor(index / 7));
	const product = pick(catalogProducts, index);
	const state = {
		...(scenario.state || {}),
		lastUserGoal: scenario.goal || scenario.state?.lastUserGoal || null,
		currentProductFocus: scenario.state?.currentProductFocus || product.name,
		commercialSummary: scenario.summary || null,
		needsHuman: false,
	};
	const intent = detectIntent(userText, state);
	if (intent === 'human_handoff') {
		state.needsHuman = true;
		state.handoffReason = 'requested_human';
	}
	if (intent === 'complaint') {
		state.needsHuman = true;
		state.handoffReason = 'sensitive_complaint';
	}
	const recentMessages = [
		{
			role: 'assistant',
			text: scenario.summary || 'Hola, soy Sofi de Lummine. Te ayudo por aca.',
		},
		{ role: 'user', text: userText },
	];
	const commercialPlan = {
		catalogAvailable: true,
		bestOffer: product,
		recommendedAction: useCampaign ? 'campaign_followup' : 'general_help',
		campaignFollowup: useCampaign,
	};
	const queueDecision = {
		queue: intent === 'human_handoff' || intent === 'complaint' ? 'HUMAN' : 'AUTO',
		aiEnabled: !['human_handoff'].includes(intent),
	};
	const responsePolicy = buildResponsePolicy({
		intent,
		enrichedState: state,
		queueDecision,
		commercialPlan,
	});

	return {
		id: `case_${String(index + 1).padStart(4, '0')}`,
		kind: useCampaign ? 'campaign' : 'normal',
		scenario: scenario.label,
		userText,
		intent,
		state,
		recentMessages,
		commercialHints: scenario.hints || [],
		commercialPlan,
		responsePolicy,
		product,
	};
}

function findIssues(testCase, finalText, rawText) {
	const normalized = normalize(finalText);
	const rawNormalized = normalize(rawText);
	const issues = [];

	if (!normalized) issues.push('empty_reply');
	if (normalized.includes('cliente')) issues.push('uses_cliente_as_name');
	if (/menu principal|ver productos\s+2|pagos, envios y talles|escribi 0|escribí 0/.test(normalized)) {
		issues.push('opens_menu');
	}
	if (/me alegra mucho|felicidades|excelente eleccion|a tu servicio|furor/.test(normalized)) {
		issues.push('overexcited_tone');
	}
	if (testCase.kind === 'campaign' && /recibimos tu consulta/.test(normalized)) {
		issues.push('pretends_customer_started_campaign');
	}
	if (testCase.scenario.includes('pending_payment') && /(promo|oferta|calzas mas elegidas|renovar)/.test(normalized)) {
		issues.push('sells_during_payment_context');
	}
	if (testCase.scenario.includes('bought') && /(comprar|aprovechar|promo|oferta|te paso el link)/.test(normalized)) {
		issues.push('keeps_selling_after_purchase');
	}
	if (testCase.intent === 'order_status' && /seguimiento:|codigo de seguimiento|seguilo aca|https?:\/\//.test(normalized)) {
		issues.push('invented_tracking');
	}
	if (testCase.intent === 'human_handoff' && !/asesora|persona|equipo|atienda|atencion humana|atención humana/.test(normalized)) {
		issues.push('missed_handoff');
	}
	if (testCase.intent === 'complaint' && /(promo|oferta|comprar|link)/.test(normalized)) {
		issues.push('sells_during_complaint');
	}
	if (rawNormalized !== normalized && rawNormalized.includes('cliente') && normalized.includes('cliente')) {
		issues.push('audit_failed_to_remove_cliente');
	}

	return issues;
}

async function runCase(testCase) {
	const fallbackReply = buildAiFailureFallback({
		intent: testCase.intent,
		enrichedState: testCase.state,
		catalogProducts: [testCase.product],
		commercialPlan: testCase.commercialPlan,
	});

	if (!testCase.responsePolicy.useAI) {
		return {
			...testCase,
			rawReply: fallbackReply,
			finalReply: fallbackReply,
			model: 'policy-fallback',
			usage: {},
			issues: findIssues(testCase, fallbackReply, fallbackReply),
		};
	}

	const aiResult = await runAssistantReply({
		businessName: process.env.BUSINESS_NAME || 'Lummine',
		contactName: testCase.kind === 'campaign' ? 'Cliente' : 'German',
		recentMessages: testCase.recentMessages,
		customerContext: {
			name: testCase.kind === 'campaign' ? 'Cliente' : 'German',
			waId: '5491100000000',
		},
		conversationState: testCase.state,
		catalogProducts: [testCase.product],
		commercialHints: testCase.commercialHints,
		commercialPlan: testCase.commercialPlan,
		responsePolicy: testCase.responsePolicy,
	});

	const audited = auditAssistantReply({
		text: aiResult.text,
		responsePolicy: testCase.responsePolicy,
		fallbackReply,
		commercialPlan: testCase.commercialPlan,
		recentMessages: testCase.recentMessages,
		contactName: testCase.kind === 'campaign' ? 'Cliente' : 'German',
		businessName: process.env.BUSINESS_NAME || 'Lummine',
		agentName: process.env.BUSINESS_AGENT_NAME || 'Sofi',
	});

	return {
		...testCase,
		rawReply: aiResult.text || '',
		finalReply: audited.finalText || '',
		model: aiResult.model,
		usage: aiResult.usage || {},
		issues: findIssues(testCase, audited.finalText || '', aiResult.text || ''),
	};
}

async function runPool(items, worker) {
	const results = new Array(items.length);
	let cursor = 0;

	async function next() {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;
			try {
				results[index] = await worker(items[index], index);
			} catch (error) {
				results[index] = {
					...items[index],
					error: error?.message || String(error),
					issues: ['runtime_error'],
				};
			}
			if ((index + 1) % 25 === 0) {
				console.log(`progress ${index + 1}/${items.length}`);
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
	return results;
}

function summarize(results) {
	const issueCounts = {};
	const scenarioCounts = {};
	const scenarioIssueCounts = {};
	let totalTokens = 0;

	for (const result of results) {
		totalTokens += Number(result.usage?.totalTokens || 0);
		scenarioCounts[result.scenario] = (scenarioCounts[result.scenario] || 0) + 1;

		for (const issue of result.issues || []) {
			issueCounts[issue] = (issueCounts[issue] || 0) + 1;
			const key = `${result.scenario}:${issue}`;
			scenarioIssueCounts[key] = (scenarioIssueCounts[key] || 0) + 1;
		}
	}

	return {
		count: results.length,
		failed: results.filter((result) => result.issues?.length || result.error).length,
		totalTokens,
		issueCounts,
		scenarioCounts,
		scenarioIssueCounts,
	};
}

const cases = Array.from({ length: COUNT }, (_, index) => buildCase(index));
const startedAt = new Date();
const results = await runPool(cases, runCase);
const summary = summarize(results);
const report = {
	startedAt: startedAt.toISOString(),
	finishedAt: new Date().toISOString(),
	provider: PROVIDER,
	model: MODEL,
	concurrency: CONCURRENCY,
	summary,
	failures: results.filter((result) => result.issues?.length || result.error).slice(0, 200),
	results,
};

await fs.mkdir(OUT_DIR, { recursive: true });
const outputPath = path.join(
	OUT_DIR,
	`ai-simulation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

console.log(JSON.stringify({ outputPath, summary }, null, 2));
