import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

import { prisma } from '../src/lib/prisma.js';
import {
	getOrCreateConversation,
	processInboundMessage,
} from '../src/services/conversation/chat.service.js';
import { createResetConversationState } from '../src/services/conversation/conversation-helpers.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_CONTACT_NAME = 'Cliente Demo';

const PRESETS = {
	'pampa-store': {
		name: 'Pampa Store',
		slug: 'ai-lab-pampa-store',
		agentName: 'Sofi',
		tone: 'cercana, clara, resolutiva y comercial',
		businessContext:
			'Marca ecommerce enfocada en indumentaria modeladora femenina. Vende por WhatsApp con tono humano, directo y comercial. Prioriza guiar por producto, talle, color, promo, link de compra, pagos y envios.',
		paymentConfig: {
			transfer: {
				alias: 'pampastore.mp',
				cbu: '0000003100000000000001',
			},
		},
		policyConfig: {
			shipping: 'Enviamos a todo Argentina. Despacho en 24 a 48 horas habiles.',
			returns: 'Cambios por talle dentro de 15 dias si la prenda esta sin uso.',
		},
		catalog: [
			{
				productId: 'body-modelador-negro',
				name: 'Body Modelador Negro',
				handle: 'body-modelador-negro',
				description: 'Body modelador de compresion media con breteles regulables.',
				price: 34990,
				compareAtPrice: 42990,
				tags: 'body modelador, negro, xl, l, faja',
				productUrl: 'https://pampastore.test/products/body-modelador-negro',
				variants: [
					{ option1: 'Negro', option2: 'L', sku: 'BODY-101' },
					{ option1: 'Negro', option2: 'XL', sku: 'BODY-102' },
				],
			},
			{
				productId: 'body-3x1',
				name: 'Promo 3x1 Bodys Modeladores',
				handle: 'promo-3x1-bodys-modeladores',
				description: 'Promo comercial 3x1 para bodys modeladores.',
				price: 69990,
				compareAtPrice: 104970,
				tags: 'promo, 3x1, bodys, body modelador',
				productUrl: 'https://pampastore.test/products/promo-3x1-bodys-modeladores',
				variants: [
					{ option1: 'Negro', option2: 'M/L', sku: 'BODY-301' },
					{ option1: 'Beige', option2: 'XL/2XL', sku: 'BODY-302' },
				],
			},
			{
				productId: 'calza-linfatica-negra',
				name: 'Calza Linfatica Negra',
				handle: 'calza-linfatica-negra',
				description: 'Calza de compresion con foco en piernas y cintura.',
				price: 38990,
				compareAtPrice: 45990,
				tags: 'calza linfatica, modeladora, negra',
				productUrl: 'https://pampastore.test/products/calza-linfatica-negra',
				variants: [
					{ option1: 'Negro', option2: 'M/L', sku: 'CALZA-101' },
					{ option1: 'Negro', option2: 'XL/2XL', sku: 'CALZA-102' },
				],
			},
			{
				productId: 'corset-beige',
				name: 'Corset Beige',
				handle: 'corset-beige',
				description: 'Corset modelador con soporte firme para cintura.',
				price: 31990,
				tags: 'corset, beige, modelador',
				productUrl: 'https://pampastore.test/products/corset-beige',
				variants: [
					{ option1: 'Beige', option2: 'S/M', sku: 'CORSET-101' },
					{ option1: 'Beige', option2: 'L/XL', sku: 'CORSET-102' },
				],
			},
		],
		scenarios: [
			'Hola, estoy buscando un body modelador',
			'Tenes en negro y talle XL?',
			'Cual promo conviene mas?',
			'Pasame el link asi compro',
			'Se puede pagar por transferencia?',
			'Hacen envios a Cordoba?',
		],
	},
	beauty: {
		name: 'Aura Beauty',
		slug: 'ai-lab-aura-beauty',
		agentName: 'Mica',
		tone: 'asesora cercana, clara y orientada a conversion',
		businessContext:
			'Tienda ecommerce de skincare y maquillaje. La asesora debe diagnosticar necesidad, recomendar pocos productos claros, explicar uso, stock, envio, pago y cierre.',
		paymentConfig: {
			transfer: {
				alias: 'aurabeauty.mp',
			},
		},
		policyConfig: {
			shipping: 'Enviamos a todo el pais y ofrecemos retiro en sucursal.',
		},
		catalog: [
			{
				productId: 'serum-vitamina-c',
				name: 'Serum Vitamina C 30 ml',
				handle: 'serum-vitamina-c-30ml',
				description: 'Serum antioxidante para iluminar y unificar tono.',
				price: 21990,
				tags: 'serum, vitamina c, skincare, piel opaca',
				productUrl: 'https://aurabeauty.test/products/serum-vitamina-c-30ml',
				variants: [{ option1: '30 ml', sku: 'SERUM-101' }],
			},
			{
				productId: 'limpiador-piel-sensible',
				name: 'Gel Limpiador Piel Sensible',
				handle: 'gel-limpiador-piel-sensible',
				description: 'Limpieza suave sin fragancia para piel sensible.',
				price: 15990,
				tags: 'limpiador, piel sensible, skincare',
				productUrl: 'https://aurabeauty.test/products/gel-limpiador-piel-sensible',
				variants: [{ option1: '200 ml', sku: 'LIMP-101' }],
			},
			{
				productId: 'kit-rutina-brillo',
				name: 'Kit Rutina Glow',
				handle: 'kit-rutina-glow',
				description: 'Combo con serum vitamina C, crema hidratante y protector facial.',
				price: 45990,
				compareAtPrice: 52990,
				tags: 'kit, combo, rutina, skincare, glow, promo',
				productUrl: 'https://aurabeauty.test/products/kit-rutina-glow',
				variants: [{ option1: 'Kit completo', sku: 'KIT-101' }],
			},
		],
		scenarios: [
			'Hola, busco un serum con vitamina c',
			'Tenes algo para piel sensible?',
			'Cual me conviene mas?',
			'Pasame link',
			'Como se paga?',
		],
	},
	electronics: {
		name: 'Nodo Tech',
		slug: 'ai-lab-nodo-tech',
		agentName: 'Tomi',
		tone: 'directo, util y consultivo',
		businessContext:
			'Ecommerce de tecnologia. La IA debe detectar uso principal, presupuesto, compatibilidad, stock, envio y cierre sin inventar especificaciones.',
		paymentConfig: {
			transfer: {
				alias: 'nodotech.mp',
			},
		},
		policyConfig: {
			shipping: 'Despacho en 24 horas habiles y retiro por showroom.',
		},
		catalog: [
			{
				productId: 'auriculares-bt-anc',
				name: 'Auriculares Bluetooth ANC',
				handle: 'auriculares-bluetooth-anc',
				description: 'Auriculares inalambricos con cancelacion de ruido y bateria extendida.',
				price: 89990,
				tags: 'auriculares, bluetooth, anc, cancelacion de ruido',
				productUrl: 'https://nodotech.test/products/auriculares-bluetooth-anc',
				variants: [{ option1: 'Negro', sku: 'AURI-101' }],
			},
			{
				productId: 'smartwatch-fit',
				name: 'Smartwatch Fit AMOLED',
				handle: 'smartwatch-fit-amoled',
				description: 'Reloj inteligente con monitoreo de actividad y pantalla AMOLED.',
				price: 129990,
				tags: 'smartwatch, reloj inteligente, deporte',
				productUrl: 'https://nodotech.test/products/smartwatch-fit-amoled',
				variants: [{ option1: 'Negro', sku: 'WATCH-101' }],
			},
			{
				productId: 'cargador-gan-65w',
				name: 'Cargador GaN 65W USB-C',
				handle: 'cargador-gan-65w-usbc',
				description: 'Cargador rapido compacto compatible con notebooks y smartphones.',
				price: 49990,
				tags: 'cargador, gan, usb c, notebook, celular',
				productUrl: 'https://nodotech.test/products/cargador-gan-65w-usbc',
				variants: [{ option1: '65W', sku: 'CARGA-101' }],
			},
		],
		scenarios: [
			'Hola, busco auriculares bluetooth',
			'Tenes con cancelacion de ruido?',
			'Cual conviene mas?',
			'Pasame el link',
			'Hacen envios?',
		],
	},
	home: {
		name: 'Casa Nativa',
		slug: 'ai-lab-casa-nativa',
		agentName: 'Luna',
		tone: 'calida, simple y comercial',
		businessContext:
			'Tienda ecommerce de hogar y deco. La IA debe ayudar a elegir por ambiente, medida, material, color, stock, envio y mantenimiento.',
		paymentConfig: {
			transfer: {
				alias: 'casanativa.mp',
			},
		},
		catalog: [
			{
				productId: 'lampara-mesa-madera',
				name: 'Lampara de Mesa Madera Natural',
				handle: 'lampara-mesa-madera-natural',
				description: 'Lampara de mesa con base de madera y pantalla textil.',
				price: 54990,
				tags: 'lampara, mesa, deco, madera',
				productUrl: 'https://casanativa.test/products/lampara-mesa-madera-natural',
				variants: [{ option1: 'Natural', sku: 'LAMP-101' }],
			},
			{
				productId: 'alfombra-yute',
				name: 'Alfombra de Yute 160x230',
				handle: 'alfombra-yute-160x230',
				description: 'Alfombra tejida en yute para living o dormitorio.',
				price: 99990,
				tags: 'alfombra, yute, living, dormitorio',
				productUrl: 'https://casanativa.test/products/alfombra-yute-160x230',
				variants: [{ option1: '160x230', sku: 'ALF-101' }],
			},
			{
				productId: 'sillon-lino',
				name: 'Sillon Lino Arena',
				handle: 'sillon-lino-arena',
				description: 'Sillon de dos cuerpos tapizado en lino color arena.',
				price: 429990,
				tags: 'sillon, lino, living, arena',
				productUrl: 'https://casanativa.test/products/sillon-lino-arena',
				variants: [{ option1: 'Arena', sku: 'SILL-101' }],
			},
		],
		scenarios: [
			'Hola, busco una lampara para mesa de luz',
			'Tenes algo en color natural?',
			'Cual me conviene para dormitorio?',
			'Pasame link',
		],
	},
};

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
  node scripts/test-ai-workspace-flow.mjs
  node scripts/test-ai-workspace-flow.mjs --preset=pampa-store
  node scripts/test-ai-workspace-flow.mjs --preset=electronics --workspace-id=workspace_demo_tech
  node scripts/test-ai-workspace-flow.mjs --preset=pampa-store --chat
  node scripts/test-ai-workspace-flow.mjs --list-presets

Opcionales:
  --preset=<pampa-store|beauty|electronics|home>
  --workspace-id=<id>
  --contact="Nombre cliente"
  --chat
  --keep-history
  --json

Notas:
  - Usa el flujo real de conversation/chat.service.js
  - Si hay GEMINI_API_KEY, toma Gemini segun GEMINI_MODEL o AI_PROVIDER
  - Resetea catalogo y conversacion demo del workspace salvo que uses --keep-history
`.trim());
}

function safeWorkspaceId(value = '') {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '') || 'workspace_demo_ai';
}

function buildWorkspaceConfig(presetKey, workspaceIdOverride = '') {
	const preset = PRESETS[presetKey];
	if (!preset) {
		throw new Error(`Preset no encontrado: ${presetKey}`);
	}

	const workspaceId = safeWorkspaceId(workspaceIdOverride || `workspace_demo_${preset.slug}`);
	return {
		workspaceId,
		preset,
	};
}

function buildCatalogRows(workspaceId, preset) {
	const storeId = `store_${preset.slug}`;

	return preset.catalog.map((product, index) => ({
		workspaceId,
		provider: 'TIENDANUBE',
		storeId,
		productId: product.productId || `${preset.slug}_${index + 1}`,
		name: product.name,
		handle: product.handle || null,
		description: product.description || null,
		brand: preset.name,
		price: product.price,
		compareAtPrice: product.compareAtPrice ?? null,
		published: product.published ?? true,
		tags: product.tags || null,
		featuredImage: product.featuredImage || null,
		productUrl: product.productUrl || null,
		variants: product.variants || [],
		images: product.images || [],
		categories: product.categories || [],
		attributes: product.attributes || [],
		rawPayload: {
			source: 'test-ai-workspace-flow',
			preset: preset.slug,
		},
	}));
}

async function ensureWorkspaceSeeded({ workspaceId, preset }) {
	const existing =
		(await prisma.workspace.findUnique({ where: { id: workspaceId } })) ||
		(await prisma.workspace.findUnique({ where: { slug: preset.slug } }));

	const resolvedWorkspaceId = existing?.id || workspaceId;

	if (existing) {
		await prisma.workspace.update({
			where: { id: existing.id },
			data: {
				name: preset.name,
				slug: preset.slug,
				status: 'ACTIVE',
			},
		});
	} else {
		await prisma.workspace.create({
			data: {
				id: resolvedWorkspaceId,
				name: preset.name,
				slug: preset.slug,
				status: 'ACTIVE',
			},
		});
	}

	await prisma.workspaceAiConfig.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		update: {
			businessName: preset.name,
			agentName: preset.agentName,
			tone: preset.tone,
			systemPrompt:
				'Responde como asesora comercial humana por WhatsApp. Sona natural, concreta, comercial y util. No inventes stock, promos, precios, productos, politicas ni links.',
			businessContext: preset.businessContext,
			paymentConfig: preset.paymentConfig || null,
			policyConfig: preset.policyConfig || null,
			catalogConfig: {
				source: 'seed_demo',
				seededBy: 'test-ai-workspace-flow',
				preset: preset.slug,
			},
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			businessName: preset.name,
			agentName: preset.agentName,
			tone: preset.tone,
			systemPrompt:
				'Responde como asesora comercial humana por WhatsApp. Sona natural, concreta, comercial y util. No inventes stock, promos, precios, productos, politicas ni links.',
			businessContext: preset.businessContext,
			paymentConfig: preset.paymentConfig || null,
			policyConfig: preset.policyConfig || null,
			catalogConfig: {
				source: 'seed_demo',
				seededBy: 'test-ai-workspace-flow',
				preset: preset.slug,
			},
		},
	});

	await prisma.workspaceBranding.upsert({
		where: { workspaceId: resolvedWorkspaceId },
		update: {
			primaryColor: '#1f2937',
			secondaryColor: '#f59e0b',
			accentColor: '#111827',
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			primaryColor: '#1f2937',
			secondaryColor: '#f59e0b',
			accentColor: '#111827',
		},
	});

	await prisma.catalogProduct.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
	await prisma.catalogProduct.createMany({
		data: buildCatalogRows(resolvedWorkspaceId, preset),
	});

	return resolvedWorkspaceId;
}

async function resetConversation({ workspaceId, waId, contactName }) {
	const conversation = await getOrCreateConversation({
		workspaceId,
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true,
		forceRouting: true,
	});

	const baseState = {
		...createResetConversationState(),
		customerName: contactName,
	};

	await prisma.$transaction([
		prisma.message.deleteMany({
			where: {
				workspaceId,
				conversationId: conversation.id,
			},
		}),
		prisma.conversation.update({
			where: { id: conversation.id },
			data: {
				queue: 'AUTO',
				aiEnabled: true,
				lastSummary: null,
				lastMessageAt: null,
				lastInboundMessageAt: null,
				lastReadAt: null,
				unreadCount: 0,
				archivedAt: null,
			},
		}),
		prisma.conversationState.upsert({
			where: { conversationId: conversation.id },
			update: baseState,
			create: {
				conversationId: conversation.id,
				...baseState,
			},
		}),
	]);

	return conversation.id;
}

async function fetchConversationSnapshot(conversationId) {
	return prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
			state: true,
			messages: {
				orderBy: { createdAt: 'asc' },
			},
		},
	});
}

function summarizeState(state = {}) {
	return {
		lastIntent: state.lastIntent || null,
		salesStage: state.salesStage || null,
		currentProductFocus: state.currentProductFocus || null,
		currentProductFamily: state.currentProductFamily || null,
		requestedOfferType: state.requestedOfferType || null,
		buyingIntentLevel: state.buyingIntentLevel || null,
		needsHuman: state.needsHuman || false,
		handoffReason: state.handoffReason || null,
		interestedProducts: Array.isArray(state.interestedProducts) ? state.interestedProducts : [],
	};
}

function summarizeTrace(trace = {}) {
	const products = Array.isArray(trace.catalogProducts) ? trace.catalogProducts : [];
	const plan = trace.commercialPlan || null;

	return {
		intent: trace.intent || null,
		provider: trace.provider || null,
		model: trace.model || null,
		shouldReply: trace.shouldReply ?? null,
		queueDecision: trace.queueDecision || null,
		responsePolicy: trace.responsePolicy
			? {
					action: trace.responsePolicy.action || null,
					useAI: trace.responsePolicy.useAI ?? null,
					tone: trace.responsePolicy.tone || null,
					maxChars: trace.responsePolicy.maxChars ?? null,
				}
			: null,
		commercialPlan: plan
			? {
					stage: plan.stage || null,
					recommendedAction: plan.recommendedAction || null,
					productFamily: plan.productFamily || null,
					productFocus: plan.productFocus || null,
					shareLinkNow: plan.shareLinkNow ?? null,
					repeatPriceNow: plan.repeatPriceNow ?? null,
					bestOffer: plan.bestOffer
						? {
								name: plan.bestOffer.name || null,
								price: plan.bestOffer.price || null,
								productUrl: plan.bestOffer.productUrl || null,
								offerType: plan.bestOffer.offerType || null,
							}
						: null,
				}
			: null,
		topCatalogProducts: products.slice(0, 3).map((product) => ({
			name: product.name,
			family: product.family || null,
			price: product.price || null,
			offerType: product.offerType || null,
			productUrl: product.productUrl || null,
		})),
	};
}

function printStep(stepNumber, inputMessage, stepReport) {
	console.log(`\n[${stepNumber}] USER`);
	console.log(inputMessage);
	console.log(`\n[${stepNumber}] ASSISTANT`);
	console.log(stepReport.assistantReply || '(sin respuesta)');
	console.log(`\n[${stepNumber}] TRACE`);
	console.log(
		JSON.stringify(
			{
				intent: stepReport.trace.intent,
				model: stepReport.trace.model,
				provider: stepReport.trace.provider,
				recommendedAction: stepReport.trace.commercialPlan?.recommendedAction || null,
				productFamily: stepReport.trace.commercialPlan?.productFamily || null,
				bestOffer: stepReport.trace.commercialPlan?.bestOffer?.name || null,
				topCatalogProducts: stepReport.trace.topCatalogProducts.map((item) => item.name),
				state: stepReport.state,
			},
			null,
			2
		)
	);
}

function buildOutputPath(presetKey) {
	const now = new Date().toISOString().replace(/[:.]/g, '-');
	return path.join(__dirname, 'output', `ai-workspace-flow-${presetKey}-${now}.json`);
}

async function sendChatTurn({
	workspaceId,
	waId,
	contactName,
	messageBody,
	presetKey,
	step,
}) {
	const result = await processInboundMessage({
		workspaceId,
		waId,
		contactName,
		messageBody,
		messageType: 'text',
		rawPayload: {
			source: 'test-ai-workspace-flow',
			mode: 'chat',
			preset: presetKey,
			step,
			disableAutoMenu: true,
		},
		transportMode: 'lab',
	});

	const conversation = await getOrCreateConversation({
		workspaceId,
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true,
		forceRouting: true,
	});
	const snapshot = await fetchConversationSnapshot(conversation.id);

	return {
		assistantReply:
			typeof result.trace?.assistantMessage === 'string'
				? result.trace.assistantMessage
				: String(result.trace?.assistantMessage?.text || '').trim(),
		trace: summarizeTrace(result.trace || {}),
		state: summarizeState(snapshot?.state || {}),
	};
}

async function runInteractiveChat({
	workspaceId,
	waId,
	contactName,
	presetKey,
	preset,
	keepHistory,
}) {
	if (!keepHistory) {
		await resetConversation({ workspaceId, waId, contactName });
	}

	const rl = readline.createInterface({ input, output });
	let step = 1;

	console.log(`\nChat de consola listo para ${preset.name}. Escribi "salir" para terminar.\n`);

	try {
		while (true) {
			const messageBody = String(await rl.question('Vos: ')).trim();
			if (!messageBody) continue;
			if (['salir', 'exit', 'quit'].includes(messageBody.toLowerCase())) break;

			const turn = await sendChatTurn({
				workspaceId,
				waId,
				contactName,
				messageBody,
				presetKey,
				step,
			});

			console.log(`IA: ${turn.assistantReply || '(sin respuesta)'}\n`);
			console.log(
				`[trace] intent=${turn.trace.intent || 'n/a'} action=${turn.trace.commercialPlan?.recommendedAction || 'n/a'} family=${turn.trace.commercialPlan?.productFamily || 'n/a'}`
			);
			console.log('');
			step += 1;
		}
	} finally {
		rl.close();
	}
}

async function main() {
	if (hasFlag('help')) {
		usage();
		process.exit(0);
	}

	if (hasFlag('list-presets')) {
		console.log(Object.keys(PRESETS).join('\n'));
		process.exit(0);
	}

	if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
		throw new Error('No hay GEMINI_API_KEY ni OPENAI_API_KEY en el entorno.');
	}

	const presetKey = readFlag('preset', 'pampa-store');
	const { workspaceId, preset } = buildWorkspaceConfig(presetKey, readFlag('workspace-id'));
	const contactName = readFlag('contact', DEFAULT_CONTACT_NAME);
	const keepHistory = hasFlag('keep-history');
	const jsonOnly = hasFlag('json');
	const chatMode = hasFlag('chat');
	const resolvedWorkspaceId = await ensureWorkspaceSeeded({ workspaceId, preset });
	const waId = `54911${resolvedWorkspaceId.replace(/[^0-9]/g, '').padEnd(10, '7').slice(0, 10)}`;

	const conversation = await getOrCreateConversation({
		workspaceId: resolvedWorkspaceId,
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true,
		forceRouting: true,
	});

	if (chatMode) {
		await runInteractiveChat({
			workspaceId: resolvedWorkspaceId,
			waId,
			contactName,
			presetKey,
			preset,
			keepHistory,
		});
		return;
	}

	if (!keepHistory) {
		await resetConversation({ workspaceId: resolvedWorkspaceId, waId, contactName });
	}

	const startedAt = Date.now();
	const steps = [];

	for (let index = 0; index < preset.scenarios.length; index += 1) {
		const messageBody = preset.scenarios[index];
		const result = await processInboundMessage({
			workspaceId: resolvedWorkspaceId,
			waId,
			contactName,
			messageBody,
			messageType: 'text',
			rawPayload: {
				source: 'test-ai-workspace-flow',
				preset: presetKey,
				step: index + 1,
			},
			transportMode: 'lab',
		});

		const snapshot = await fetchConversationSnapshot(conversation.id);
		const trace = summarizeTrace(result.trace || {});
		const assistantReply =
			typeof result.trace?.assistantMessage === 'string'
				? result.trace.assistantMessage
				: String(result.trace?.assistantMessage?.text || '').trim();

		const stepReport = {
			step: index + 1,
			userMessage: messageBody,
			assistantReply,
			trace,
			state: summarizeState(snapshot?.state || {}),
			messageCount: snapshot?.messages?.length || 0,
			lastSummary: snapshot?.lastSummary || null,
		};

		steps.push(stepReport);

		if (!jsonOnly) {
			printStep(index + 1, messageBody, stepReport);
		}
	}

	const report = {
		runAt: new Date().toISOString(),
		elapsedMs: Date.now() - startedAt,
		preset: presetKey,
		workspaceId: resolvedWorkspaceId,
		workspaceName: preset.name,
		providerPreference: process.env.AI_PROVIDER || 'gemini',
		model:
			process.env.AI_PROVIDER === 'openai'
				? process.env.OPENAI_MODEL || null
				: process.env.GEMINI_MODEL || null,
		contactName,
		catalogCount: preset.catalog.length,
		businessContext: preset.businessContext,
		steps,
		notes: [
			'El flujo usa processInboundMessage real del backend.',
			'Si el preset no es moda, el commercial brain actual puede responder mas generico porque sus familias comerciales estan orientadas a indumentaria.',
		],
	};

	const outputPath = buildOutputPath(presetKey);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	if (jsonOnly) {
		console.log(JSON.stringify(report, null, 2));
		return;
	}

	console.log('\n=== RESUMEN ===');
	console.log(
		JSON.stringify(
			{
				workspaceId: resolvedWorkspaceId,
				requestedWorkspaceId: workspaceId,
				preset: presetKey,
				steps: steps.length,
				elapsedMs: report.elapsedMs,
				outputPath,
			},
			null,
			2
		)
	);
}

main()
	.catch((error) => {
		console.error('\n[AI WORKSPACE FLOW ERROR]');
		console.error(error?.message || error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect().catch(() => {});
	});
