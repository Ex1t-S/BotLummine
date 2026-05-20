import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

dotenv.config({ path: '.env' });

const { prisma } = await import('../src/lib/prisma.js');
const { getOrCreateConversation, processInboundMessage } = await import('../src/services/conversation/chat.service.js');
const { DEFAULT_WORKSPACE_ID } = await import('../src/services/workspaces/workspace-context.service.js');

const REPORT_DIR = path.resolve('reports/ai-campaign-qa');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const QA_PREFIX = `AIQA_CAMPAIGN_${RUN_ID}`;
const args = new Set(process.argv.slice(2));
const SMOKE = args.has('--smoke');
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1] || 0) : 0;
const FROM_ARG = process.argv.find((arg) => arg.startsWith('--from='));
const FROM_INDEX = FROM_ARG ? Number(FROM_ARG.split('=')[1] || 0) : 0;
const APPEND_EXISTING = args.has('--append-existing');
const MAX_TURNS = Number(process.env.AI_CAMPAIGN_QA_MAX_TURNS || 10);

function normalize(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function csvCell(value = '') {
	const text = String(value ?? '').replace(/\r?\n/g, ' ');
	return `"${text.replace(/"/g, '""')}"`;
}

function makePhone(index) {
	const runDigits = RUN_ID.replace(/\D/g, '').slice(-4);
	return `54911${runDigits}${String(index).padStart(4, '0')}`;
}

function getAssistantMessages(messages = []) {
	return messages.filter((message) => message.direction === 'OUTBOUND');
}

function latestAssistantText(conversation = null) {
	const assistant = getAssistantMessages(conversation?.messages || []);
	return String(assistant[assistant.length - 1]?.body || '');
}

function inferOutcome({ trace, reply, conversation }) {
	const text = normalize(reply || trace?.assistantMessage || '');
	const queue = conversation?.queue || trace?.queueDecision?.queue || '';
	const model = trace?.model || '';

	if (queue === 'HUMAN' || /te paso con|asesora|persona del equipo|humano/.test(text)) return 'human_handoff';
	if (queue === 'PAYMENT_REVIEW' || model === 'payment-proof-router') return 'payment_review';
	if (trace?.provider === 'system' && trace?.shouldReply === false && !trace?.assistantMessage) return 'silent_valid';
	if (/(link|comprar|terminar la compra|finalizar|comprobante|alias|medio de pago|pago pendiente)/.test(text)) return 'advanced';
	if (!text) return 'no_reply';
	return 'answered';
}

function shouldStopConversation({ trace, reply, conversation, turnIndex }) {
	const outcome = inferOutcome({ trace, reply, conversation });
	if (['human_handoff', 'payment_review', 'silent_valid'].includes(outcome)) {
		return { stop: true, reason: outcome };
	}

	const text = normalize(reply || trace?.assistantMessage || '');
	if (turnIndex >= 3 && /(te paso el link|podes finalizar|terminar la compra|te dejo el link|pasame el comprobante|te paso con una asesora)/.test(text)) {
		return { stop: true, reason: 'clear_next_step' };
	}

	return { stop: false, reason: '' };
}

function scoreConversation({ caseDef, turns, finalConversation }) {
	const joinedReplies = normalize(turns.map((turn) => turn.assistantReply || '').join(' '));
	const joinedUser = normalize(turns.map((turn) => turn.userMessage || '').join(' '));
	const finalTrace = turns[turns.length - 1]?.trace || {};
	const finalUser = normalize(turns[turns.length - 1]?.userMessage || '');
	const correctSilentClose =
		inferOutcome({
			trace: finalTrace,
			reply: turns[turns.length - 1]?.assistantReply || '',
			conversation: finalConversation,
		}) === 'silent_valid' &&
		/^(ok|okay|oka|oki|dale|listo|gracias|muchas gracias|perfecto|genial|joya|bueno|lo miro|lo hago)[\s!.]*$/.test(finalUser) &&
		turns.slice(0, -1).some((turn) => normalize(turn.assistantReply || '').length > 0);
	const sawCampaignObjective = turns.some((turn) => (
		turn?.trace?.campaignAssistantContext?.objective === caseDef.expectedObjective
	));
	const category = caseDef.category;
	const queue = finalConversation?.queue || finalTrace?.queueDecision?.queue || '';

	const checks = {
		campaignContext:
			sawCampaignObjective ||
			joinedReplies.includes(category === 'pending_payment' ? 'pago' : category === 'cart_recovery' ? 'carrito' : 'promo'),
		relevance: !/(no entiendo tu consulta|no tengo contexto|no se a que te referis)/.test(joinedReplies),
		noInventedMedia: !/(\[imagen|\[foto|\[video|te mando la foto|te paso el video|busco el video)/.test(joinedReplies),
		noUnsafeOps: !/(ya esta pago|ya se acredito|ya cancele|queda cancelado|te confirmo el tracking)/.test(joinedReplies),
		handoff:
			!/humano|persona|no me entendes|no quiero ia/.test(joinedUser) ||
			queue === 'HUMAN' ||
			/te paso con|asesora|persona del equipo/.test(joinedReplies),
		natural: !/(hola\s+\w+,?\s+soy\s+.+hola|claro.*claro.*claro|perfecto.*perfecto.*perfecto)/.test(joinedReplies),
		objective:
			correctSilentClose ||
			(category === 'pending_payment'
				? /(pago|comprobante|medio de pago|pendiente|alias|tarjeta|transferencia)/.test(joinedReplies)
				: category === 'cart_recovery'
					? /(carrito|compra|finalizar|link|duda|talle|envio|stock|cambio|tela|queda)/.test(joinedReplies)
					: /(producto|promo|oferta|precio|talle|stock|link|comprar)/.test(joinedReplies)),
		silence:
			finalTrace?.provider !== 'system' ||
			finalTrace?.shouldReply !== false ||
			Boolean(finalTrace?.assistantMessage) ||
			correctSilentClose ||
			/(humano|persona|no me entendes|no quiero ia|comprobante|ya pague|pasame|link|quiero)/.test(finalUser) === false,
	};

	const score = Object.values(checks).filter(Boolean).length;
	const score5 = Math.round((score / Object.keys(checks).length) * 50) / 10;
	const failedChecks = Object.entries(checks)
		.filter(([, pass]) => !pass)
		.map(([key]) => key);

	return {
		score5,
		checks,
		failedChecks,
		outcome: inferOutcome({
			trace: finalTrace,
			reply: turns[turns.length - 1]?.assistantReply || '',
			conversation: finalConversation,
		}),
		primaryFailure: failedChecks[0] || '',
	};
}

async function resolveWorkspaceIds() {
	const rows = await prisma.workspace.findMany({
		where: {
			OR: [
				{ id: { in: ['workspace_lummine', 'workspace_ruchi', 'ruchiargentina', 'lummine'] } },
				{ slug: { in: ['lummine', 'ruchiargentina', 'ruchi'] } },
				{ name: { contains: 'Lummine', mode: 'insensitive' } },
				{ name: { contains: 'Ruchi', mode: 'insensitive' } },
			],
		},
		select: { id: true, slug: true, name: true },
	});

	const lummine = rows.find((row) => /lummine/i.test(`${row.id} ${row.slug} ${row.name}`))?.id || 'workspace_lummine';
	const ruchi = rows.find((row) => /ruchi/i.test(`${row.id} ${row.slug} ${row.name}`))?.id || 'ruchiargentina';
	return { lummine, ruchi };
}

const pendingPaymentMessages = [
	['Hola, me llego que tengo un pago pendiente pero no se de que compra es', 'Puede ser que haya quedado a medias?', 'Si era una compra de ayer', 'Quiero pagar con transferencia', 'Me pasas como sigo?', 'El link me sirve o tengo que hacer otro pedido?', 'Te puedo mandar comprobante por aca?', 'Dale, lo hago ahora', 'Ya transferi', 'Gracias'],
	['Buenas, me avisaron que falta el pago', 'No me tomo la tarjeta', 'Puedo intentar con mercado pago?', 'Me da miedo pagar dos veces', 'Que hago para no duplicar?', 'El pedido queda reservado?', 'Si pago ahora cuando sale?', 'Pasame el paso correcto', 'Ok avanzo', 'Listo'],
	['Hola, tengo un pedido pendiente de pago?', 'No recuerdo si lo termine', 'Compre un body creo', 'Me decis si falta pagar?', 'Quiero conservar la promo', 'Puedo pagar hoy?', 'Me interesa seguir', 'Que dato necesitas?', 'Perfecto', 'Gracias'],
	['Me llego pago pendiente pero yo ya pague', 'Tengo comprobante', 'Lo mando por aca?', 'No quiero que me cancelen el pedido', 'Ahi te paso la imagen', 'Es transferencia', 'Queda en revision?', 'Avisame si falta algo', 'Gracias', 'Espero'],
	['Hola, me salio error al pagar', 'Era con tarjeta', 'No se si entro o no', 'Me ayudas?', 'Quiero terminar la compra', 'Puedo cambiar el medio de pago?', 'Si hay link pasamelo', 'Dale', 'Ahora lo hago', 'Gracias'],
	['Buenas, pago pendiente de que seria?', 'Yo habia elegido unas calzas', 'El checkout se me cerro', 'Sigue vigente?', 'Me gustaria pagarlo', 'Hay cuotas?', 'Si no, transferencia', 'Pasame el camino mas simple', 'Ok', 'Gracias'],
	['Hola no entiendo el mensaje de pago pendiente', 'Me pueden explicar?', 'Yo no soy buena con la web', 'Quiero comprar igual', 'Me guias paso a paso?', 'No quiero perder el carrito', 'Puedo pagar por alias?', 'Listo pasamelo', 'Te aviso', 'Gracias'],
	['Me escribieron por una compra sin pagar', 'Si, la deje porque no tenia la tarjeta', 'Ahora quiero hacerla', 'El precio sigue igual?', 'Es el mismo link?', 'Me pasas como finalizar?', 'Si tengo problema te escribo', 'Dale', 'Gracias', ''],
	['Hola, el pago quedo pendiente porque no me llego el codigo', 'Puedo pagar de otra forma?', 'Era para regalar', 'Lo necesito rapido', 'Que conviene?', 'No me mandes promo, quiero pagar esto', 'Pasame el paso', 'Ok', 'Ya lo intento', 'Gracias'],
	['Buenas, me figura pago pendiente', 'No quiero comprar otra cosa', 'Solo terminar ese pedido', 'Me decis que hacer?', 'Tengo debito', 'Sirve?', 'Si falla puedo transferir?', 'Pasame instrucciones', 'Dale', 'Gracias'],
];

const cartMessages = [
	['Hola, deje algo en el carrito', 'Estoy dudando por el talle', 'Uso 44 de pantalon', 'No quiero que se enrolle', 'Cual me recomendas?', 'Si me sirve lo compro', 'Hay cambio si no va?', 'Pasame el link', 'Gracias', ''],
	['Me llego lo del carrito', 'Si lo habia dejado', 'Me parecio caro', 'Hay alguna promo?', 'Quiero algo que modele pero comodo', 'No quiero faja dura', 'Que opcion va mejor?', 'Dale pasame', 'Lo miro', 'Gracias'],
	['Hola, estaba viendo la calza', 'Queria saber si transparenta', 'Y si se baja al caminar', 'Tengo miedo de comprar online', 'Hay tabla de talles?', 'Si me ayudas cierro', 'Me pasas link?', 'Ok', 'Gracias', ''],
	['Buenas, deje un body en carrito', 'Me interesa pero no se si hay negro', 'Talle XL tenes?', 'Si no hay que alternativa?', 'No quiero pantymedia', 'Solo body', 'Me pasas el correcto?', 'Dale', 'Gracias', ''],
	['Hola, el carrito era mio', 'Me quede sin tiempo', 'Sigue guardado?', 'La promo sigue?', 'Era para hoy', 'Me conviene finalizar ahora?', 'Pasame el paso', 'Dale', 'Gracias', ''],
	['Me escribieron del carrito', 'Si pero tengo dudas de envio', 'Soy de Cordoba', 'Cuanto tarda?', 'Y si no me queda?', 'Quiero comprar si es seguro', 'Me orientas?', 'Pasame link', 'Ok', ''],
	['Hola, puse varias cosas en carrito', 'No se cual conviene', 'Quiero modelador', 'Pero comodo para usar todo el dia', 'No quiero que marque', 'Que me recomendas?', 'Hay descuento?', 'Dale', 'Me sirve', 'Gracias'],
	['Buenas, abandone porque no sabia pagar', 'Puedo hacerlo por transferencia?', 'Me respetan lo del carrito?', 'Era con promo', 'No quiero volver a cargar todo', 'Me pasas como sigo?', 'Ok', 'Lo hago', 'Gracias', ''],
	['Hola, lo del carrito', 'Mi duda es si cambia la tela', 'Morley o lycra?', 'Necesito que ajuste', 'Pero no incomode', 'Cual es?', 'Si me confirmas avanzo', 'Pasame link', 'Dale', 'Gracias'],
	['Me llego recordatorio del carrito', 'Ya no quiero eso', 'Ahora busco otro producto', 'Tenes corpiños?', 'Que promos hay?', 'No me mandes lo anterior', 'Mostrame una opcion', 'Gracias', '', ''],
];

const marketingMessages = [
	['Hola, vi la promo', 'Que incluye exactamente?', 'Es 3x1?', 'Hay talles grandes?', 'Uso XL', 'Me sirve para abdomen?', 'Cual me conviene?', 'Pasame link', 'Gracias', ''],
	['Buenas, me llego una oferta', 'No entendi el producto', 'Es faja o body?', 'Quiero algo comodo', 'No quiero que se note bajo la ropa', 'Me explicas?', 'Precio?', 'Dale', 'Gracias', ''],
	['Hola, tienen stock de la promo?', 'Quiero negro', 'Talle M', 'Cuanto sale?', 'Hay envio?', 'Soy de Mendoza', 'Si llega rapido compro', 'Pasame link', 'Ok', ''],
	['Vi el mensaje de hot sale', 'Sigue vigente?', 'Me interesa comprar dos', 'Hay descuento?', 'Cual recomendas para uso diario?', 'No quiero algo muy apretado', 'Me pasas opciones?', 'Gracias', '', ''],
	['Hola, la promo es para cualquier producto?', 'Queria calzas', 'Pero tambien vi body', 'Que conviene mas?', 'Tengo dudas por talle', 'Me ayudas?', 'Pasame una sola recomendacion', 'Dale', ''],
	['Buenas, me interesa la promocion', 'Pero no conozco la marca', 'Como son los cambios?', 'Y la calidad?', 'No quiero que se rompa rapido', 'Tenes referencias?', 'Si me da confianza compro', 'Precio?', 'Gracias', ''],
	['Hola, me llego marketing pero necesito otra cosa', 'Estoy buscando cambio de un pedido', 'Me vino mal el talle', 'No quiero comprar ahora', 'Me ayudas con eso?', 'Pedido 12345', 'Quiero persona', 'Gracias', '', ''],
	['Vi la promo de hoy', 'Hay color nude?', 'Y blanco?', 'Quiero para vestido', 'Que no se marque', 'Cual seria?', 'Me pasas link y precio?', 'Dale', 'Gracias', ''],
	['Hola, quiero aprovechar la oferta', 'Pero cobro manana', 'La puedo dejar reservada?', 'Sigue hasta cuando?', 'Si no se puede decime', 'Me interesa igual', 'Que paso sigo?', 'Ok', ''],
	['Buenas, me llego el mensaje', 'NO ATENDEMOS LLAMADAS', 'Dejanos tu consulta y horarios', 'Gracias por comunicarte', 'Lunes a viernes de 9 a 18', '', '', '', '', ''],
];

const riskMessages = [
	['No me gusta hablar con IA', 'Quiero una persona', 'No me entienden', 'Pasame con alguien', '', '', '', '', '', ''],
	['Gracias por tu mensaje', 'No hacemos ventas online', 'Horarios: lunes a viernes', 'Dejanos tu consulta', '', '', '', '', '', ''],
	['Me estan escribiendo de pago pendiente pero yo quiero reclamar', 'Me llego mal el producto', 'No quiero comprar', 'Quiero cambio', 'Me responde una persona?', '', '', '', '', ''],
	['El carrito era de una calza pero ahora busco corpiño', 'No me mandes calzas', 'Tenes algo con aro?', 'Precio?', 'Link?', '', '', '', '', ''],
	['La promo me parece engañosa', 'Dice una cosa y despues otra', 'No se entiende', 'Me da desconfianza', 'Quiero que me expliquen simple', '', '', '', '', ''],
	['Ya pague y me siguen reclamando pago', 'Esto es molesto', 'Tengo comprobante', 'No quiero volver a pagar', 'Persona por favor', '', '', '', '', ''],
	['Hola?', '???', 'No me entendes', 'Te estoy diciendo otra cosa', 'Humano', '', '', '', '', ''],
	['Me interesa pero no tengo talle', 'Uso XXXL', 'Siempre me queda chico', 'Si no tienen no me hagan perder tiempo', 'Hay o no hay?', '', '', '', '', ''],
	['Quiero comprar pero no por web', 'Me da miedo poner tarjeta', 'Solo transferencia', 'Si no se puede chau', 'Como hacemos?', '', '', '', '', ''],
	['Era promo pero necesito seguimiento', 'Pedido 45678', 'No llego', 'Hace una semana', 'No quiero ofertas', 'Quiero saber donde esta', '', '', '', ''],
];

function buildCases(workspaces) {
	const brands = [
		{ key: 'lummine', workspaceId: workspaces.lummine },
		{ key: 'ruchi', workspaceId: workspaces.ruchi },
	];

	const definitions = [];
	let index = 1;
	const pushSet = ({ category, expectedObjective, audienceSource, templateName, campaignText, messageSets, count }) => {
		for (let i = 0; i < count; i += 1) {
			const brand = brands[i % brands.length];
			const messages = messageSets[i % messageSets.length].filter(Boolean).slice(0, MAX_TURNS);
			definitions.push({
				id: `case_${String(index).padStart(3, '0')}_${brand.key}_${category}`,
				index,
				brand: brand.key,
				workspaceId: brand.workspaceId,
				category,
				expectedObjective,
				audienceSource,
				templateName,
				campaignText,
				messages,
			});
			index += 1;
		}
	};

	pushSet({
		category: 'pending_payment',
		expectedObjective: 'pago_pendiente',
		audienceSource: 'pending_payment',
		templateName: 'qa_pago_pendiente_v1',
		campaignText: 'Tu compra quedo con pago pendiente. Si queres finalizarla, respondeme y te ayudo con el proximo paso.',
		messageSets: pendingPaymentMessages,
		count: 30,
	});
	pushSet({
		category: 'cart_recovery',
		expectedObjective: 'recuperacion_de_carrito',
		audienceSource: 'abandoned_carts',
		templateName: 'qa_carrito_abandonado_v1',
		campaignText: 'Vimos que dejaste productos en tu carrito. Si tenes dudas, respondeme y te ayudo a finalizar la compra.',
		messageSets: cartMessages,
		count: 30,
	});
	pushSet({
		category: 'marketing',
		expectedObjective: 'venta_promocionada',
		audienceSource: 'marketing',
		templateName: 'qa_marketing_promo_v1',
		campaignText: 'Tenemos una promo especial por tiempo limitado. Respondeme y te cuento cual opcion te conviene.',
		messageSets: marketingMessages,
		count: 30,
	});
	pushSet({
		category: 'risk',
		expectedObjective: 'venta_promocionada',
		audienceSource: 'marketing',
		templateName: 'qa_mixta_riesgo_v1',
		campaignText: 'Campania de prueba con contexto comercial para evaluar cambios de tema y escalamiento.',
		messageSets: riskMessages,
		count: 10,
	});

	return definitions;
}

async function seedCampaignOutbound(caseDef, conversationId) {
	const createdAt = new Date(Date.now() - 60_000);
	await prisma.message.create({
		data: {
			conversationId,
			workspaceId: caseDef.workspaceId,
			direction: 'OUTBOUND',
			type: 'template',
			body: caseDef.campaignText,
			provider: 'whatsapp-cloud-api',
			model: caseDef.templateName,
			metaMessageId: `lab_campaign_${caseDef.id}_${Date.now()}`,
			rawPayload: {
				deliveryMode: 'lab',
				campaignMeta: {
					campaignId: `qa_${caseDef.id}`,
					audienceSource: caseDef.audienceSource,
					templateName: caseDef.templateName,
				},
			},
			createdAt,
		},
	});
	await prisma.conversation.update({
		where: { id: conversationId },
		data: { lastMessageAt: createdAt },
	});
}

async function hideQaConversation(conversationId) {
	if (!conversationId) return;
	await prisma.conversation.update({
		where: { id: conversationId },
		data: {
			archivedAt: new Date(),
			unreadCount: 0,
		},
	});
}

async function fetchConversation(conversationId) {
	return prisma.conversation.findUnique({
		where: { id: conversationId },
		include: {
			contact: true,
			state: true,
			messages: { orderBy: { createdAt: 'asc' } },
		},
	});
}

async function runCase(caseDef) {
	const waId = makePhone(caseDef.index);
	const contactName = `${QA_PREFIX}_${caseDef.id}`;
	const conversation = await getOrCreateConversation({
		workspaceId: caseDef.workspaceId || DEFAULT_WORKSPACE_ID,
		waId,
		contactName,
		queue: 'AUTO',
		aiEnabled: true,
		forceRouting: true,
	});

	await seedCampaignOutbound(caseDef, conversation.id);
	await hideQaConversation(conversation.id);

	const turns = [];
	let stopReason = '';
	let finalConversation = await fetchConversation(conversation.id);

	for (let turnIndex = 0; turnIndex < caseDef.messages.length; turnIndex += 1) {
		const userMessage = caseDef.messages[turnIndex];
		const before = await fetchConversation(conversation.id);
		const beforeAssistantCount = getAssistantMessages(before?.messages || []).length;
		const result = await processInboundMessage({
			workspaceId: caseDef.workspaceId,
			waId,
			contactName,
			messageBody: userMessage,
			messageType: 'text',
			rawPayload: {
				source: 'ai-campaign-qa',
				runId: RUN_ID,
				caseId: caseDef.id,
				turnIndex,
			},
			transportMode: 'lab',
		});
		finalConversation = await fetchConversation(conversation.id);
		await hideQaConversation(conversation.id);
		finalConversation = await fetchConversation(conversation.id);
		const afterAssistantCount = getAssistantMessages(finalConversation?.messages || []).length;
		const assistantReply = afterAssistantCount > beforeAssistantCount
			? latestAssistantText(finalConversation)
			: result.trace?.assistantMessage || '';
		const stop = shouldStopConversation({
			trace: result.trace,
			reply: assistantReply,
			conversation: finalConversation,
			turnIndex,
		});

		turns.push({
			turn: turnIndex + 1,
			userMessage,
			assistantReply,
			trace: result.trace || null,
			beforeAssistantCount,
			afterAssistantCount,
		});

		if (stop.stop) {
			stopReason = stop.reason;
			break;
		}
	}

	const evaluation = scoreConversation({ caseDef, turns, finalConversation });
	await prisma.conversation.update({
		where: { id: conversation.id },
		data: {
			archivedAt: new Date(),
			unreadCount: 0,
			aiEnabled: false,
		},
	});

	return {
		...caseDef,
		conversationId: conversation.id,
		contactWaId: waId,
		turns,
		finalQueue: finalConversation?.queue || '',
		finalAiEnabled: finalConversation?.aiEnabled ?? null,
		stopReason,
		evaluation,
	};
}

function buildCsv(results) {
	const headers = [
		'id',
		'brand',
		'category',
		'score5',
		'outcome',
		'primaryFailure',
		'turns',
		'finalQueue',
		'stopReason',
		'conversationId',
	];
	const rows = results.map((result) => [
		result.id,
		result.brand,
		result.category,
		result.evaluation.score5,
		result.evaluation.outcome,
		result.evaluation.primaryFailure,
		result.turns.length,
		result.finalQueue,
		result.stopReason,
		result.conversationId,
	]);
	return [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n');
}

function groupBy(items, keyFn) {
	const map = new Map();
	for (const item of items) {
		const key = keyFn(item);
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(item);
	}
	return map;
}

function average(items, valueFn) {
	if (!items.length) return 0;
	return Math.round((items.reduce((sum, item) => sum + Number(valueFn(item) || 0), 0) / items.length) * 10) / 10;
}

function buildQaReport(results) {
	const byCategory = [...groupBy(results, (result) => result.category).entries()];
	const byBrand = [...groupBy(results, (result) => result.brand).entries()];
	const failures = results.filter((result) => result.evaluation.failedChecks.length);
	const topFailures = [...groupBy(failures.flatMap((result) => result.evaluation.failedChecks), (item) => item).entries()]
		.map(([key, rows]) => ({ key, count: rows.length }))
		.sort((a, b) => b.count - a.count);
	const examples = failures.slice(0, 12).map((result) => {
		const lastTurn = result.turns[result.turns.length - 1] || {};
		return `- ${result.id} (${result.brand}/${result.category}) score ${result.evaluation.score5}: falla ${result.evaluation.primaryFailure || 'n/a'}\n  Cliente: ${lastTurn.userMessage || ''}\n  IA: ${lastTurn.assistantReply || '[sin respuesta]'}`;
	}).join('\n');

	return [
		'# Reporte QA de IA en Campanas',
		'',
		`Run: ${RUN_ID}`,
		`Total conversaciones: ${results.length}`,
		`Score promedio: ${average(results, (result) => result.evaluation.score5)} / 5`,
		'',
		'## Score por tipo',
		...byCategory.map(([category, rows]) => `- ${category}: ${average(rows, (result) => result.evaluation.score5)} / 5 (${rows.length} casos)`),
		'',
		'## Score por marca',
		...byBrand.map(([brand, rows]) => `- ${brand}: ${average(rows, (result) => result.evaluation.score5)} / 5 (${rows.length} casos)`),
		'',
		'## Fallas mas repetidas',
		...(topFailures.length ? topFailures.map((item) => `- ${item.key}: ${item.count}`) : ['- Sin fallas detectadas por reglas automaticas.']),
		'',
		'## Ejemplos a revisar',
		examples || '- Sin ejemplos fallidos.',
		'',
		'## Lectura profesional',
		'- La IA ya tiene buena estructura para distinguir venta, soporte, comprobantes, menu y contexto de campana.',
		'- La calidad real depende de que el contexto de campana llegue bien en `rawPayload.campaignMeta` y de que el catalogo tenga productos confiables.',
		'- Los riesgos principales siguen siendo cambios de tema, objeciones con detalles de talle/tela y promesas operativas si el modelo intenta completar datos faltantes.',
		'- Las derivaciones a humano deben mirarse como exito cuando hay frustracion, pedido explicito de persona o reclamo postventa.',
		'',
	].join('\n');
}

function buildArchitectureReport(results) {
	const avgScore = average(results, (result) => result.evaluation.score5);
	return [
		'# Revision Profesional de Arquitectura IA',
		'',
		'## Flujo actual',
		'- WhatsApp entra por webhook y se persiste como inbound antes de decidir respuesta.',
		'- El flujo principal pasa por menu, contexto de campana, deteccion de intent, reply gate, cooldown live, memoria, routing y generacion.',
		'- El routing separa `AUTO`, `HUMAN` y `PAYMENT_REVIEW`, evitando que la IA siga cuando hay comprobante, reclamo fuerte o pedido humano.',
		'- El prompt final combina estado, politicas, catalogo, commercial brain, menu context y campaign context.',
		'- La generacion usa cadena de providers con Gemini/OpenAI y luego audita la respuesta antes de persistir outbound.',
		'',
		'## Estado para su funcion',
		`- Score automatico del QA: ${avgScore} / 5 sobre ${results.length} conversaciones.`,
		'- Para venta asistida, la base es razonable: tiene memoria comercial, ranking de productos, reglas anti-repeticion y protecciones de catalogo.',
		'- Para campanas, la mejora clave ya es el `campaignAssistantContext`: evita respuestas genericas cuando la respuesta del cliente viene de pago pendiente, carrito o promo.',
		'- Para soporte/postventa, el sistema es mas conservador: corta a humano o revision de pago cuando detecta riesgo operativo.',
		'',
		'## Fortalezas',
		'- Buen desacople entre reglas deterministicas y modelo generativo.',
		'- Trazabilidad alta: intent, queue, response policy, commercial plan, prompt y provider quedan disponibles.',
		'- Protecciones utiles contra inventar tracking, acciones operativas, catalogo y multimedia.',
		'- Modo lab permite probar sin enviar WhatsApp real.',
		'',
		'## Falencias posibles',
		'- Muchas reglas viven como regex dispersas; eso puede generar inconsistencias entre intent, gate, memoria y audit.',
		'- El contexto de campana depende del ultimo outbound con metadata correcta; si falta `campaignMeta`, la IA pierde objetivo.',
		'- El debounce live es en memoria; si el proceso reinicia, los timers pendientes se pierden.',
		'- La evaluacion de calidad todavia no es parte de CI ni bloquea regresiones automaticamente.',
		'- La IA puede seguir siendo debil ante mensajes largos con varias intenciones mezcladas si el intent principal queda mal clasificado.',
		'',
		'## Recomendaciones priorizadas',
		'1. Convertir este QA en suite recurrente con subset rapido obligatorio antes de deploy.',
		'2. Persistir campaign context normalizado en conversation state cuando entra una respuesta de campana.',
		'3. Unificar detectores de humano/frustracion/auto-respuesta en un modulo unico reutilizable.',
		'4. Pasar el cooldown a una cola persistente si se escala a produccion multi-instancia.',
		'5. Agregar evaluador LLM offline para complementar los scores por regex con juicio semantico.',
		'',
	].join('\n');
}

async function writeReports(results) {
	await fs.mkdir(REPORT_DIR, { recursive: true });
	await fs.writeFile(path.join(REPORT_DIR, 'ai-campaign-qa-results.json'), JSON.stringify({ runId: RUN_ID, results }, null, 2));
	await fs.writeFile(path.join(REPORT_DIR, 'ai-campaign-qa-summary.csv'), buildCsv(results));
	await fs.writeFile(path.join(REPORT_DIR, 'ai-campaign-qa-report.md'), buildQaReport(results));
	await fs.writeFile(path.join(REPORT_DIR, 'ai-architecture-review.md'), buildArchitectureReport(results));
}

async function readExistingResults() {
	if (!APPEND_EXISTING) return [];
	try {
		const raw = await fs.readFile(path.join(REPORT_DIR, 'ai-campaign-qa-results.json'), 'utf8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed?.results) ? parsed.results : [];
	} catch {
		return [];
	}
}

try {
	const workspaces = await resolveWorkspaceIds();
	let cases = buildCases(workspaces);

	if (SMOKE) {
		cases = [
			cases.find((item) => item.category === 'pending_payment' && item.brand === 'lummine'),
			cases.find((item) => item.category === 'pending_payment' && item.brand === 'ruchi'),
			cases.find((item) => item.category === 'cart_recovery' && item.brand === 'lummine'),
			cases.find((item) => item.category === 'cart_recovery' && item.brand === 'ruchi'),
			cases.find((item) => item.category === 'marketing' && item.brand === 'lummine'),
			cases.find((item) => item.category === 'marketing' && item.brand === 'ruchi'),
		].filter(Boolean);
	}

	if (LIMIT > 0) {
		cases = cases.slice(0, LIMIT);
	}

	if (FROM_INDEX > 0) {
		cases = cases.filter((caseDef) => caseDef.index >= FROM_INDEX);
	}

	const results = await readExistingResults();
	const existingIds = new Set(results.map((result) => result.id));
	cases = cases.filter((caseDef) => !existingIds.has(caseDef.id));

	for (const caseDef of cases) {
		console.log(`[${results.length + 1}/${results.length + cases.length}] ${caseDef.id}`);
		results.push(await runCase(caseDef));
		await writeReports(results);
	}

	const failed = results.filter((result) => result.evaluation.failedChecks.length);
	console.log(JSON.stringify({
		runId: RUN_ID,
		total: results.length,
		averageScore: average(results, (result) => result.evaluation.score5),
		failed: failed.length,
		reportDir: REPORT_DIR,
	}, null, 2));
} finally {
	await prisma.$disconnect();
}
