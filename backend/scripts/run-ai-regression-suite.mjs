import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const { createAiLabSession, sendAiLabMessage } = await import('../src/services/ai/ai-lab.service.js');
const { prisma } = await import('../src/lib/prisma.js');

const WORKSPACE_ID = process.env.AI_REGRESSION_WORKSPACE_ID || 'workspace_lummine';

const SCENARIOS = [
	{
		key: 'post-campaign-cart-later',
		fixtureKey: 'real-cart-later',
		turns: ['Hola Sofi, lo tengo que dejar para mas adelante. Gracias!'],
		checks: ['no_link', 'no_price', 'no_wrong_name'],
	},
	{
		key: 'cancel-card-needs-human',
		fixtureKey: 'real-cancel-card-issue',
		turns: ['Si pueden cancelar la compra, en alguna otra oportunidad vuelvo a intentar', 'Gracias!'],
		checks: ['no_cancel_promise', 'no_operational_promise', 'human_or_fixed', 'no_extra_after_thanks'],
	},
	{
		key: 'size-fabric-doubt',
		fixtureKey: 'real-size-fabric-doubt',
		turns: ['Buen dia dudo por el talle y la tela', 'Soy XL'],
		checks: ['no_link', 'no_unconfirmed_catalog_claim'],
	},
	{
		key: 'order-delay-no-tracking',
		fixtureKey: 'real-order-delay-no-tracking',
		turns: ['Pero hace una semana que lo estan preparando'],
		checks: ['human_or_fixed', 'tracking_followup_copy', 'no_promo'],
	},
	{
		key: 'order-tracking-closing-suppressed',
		fixtureKey: 'real-order-delay-no-tracking',
		turns: ['Oki, perfecto! Espero entonces! Muchas gracias'],
		checks: ['suppressed'],
	},
	{
		key: 'scam-complaint-human',
		fixtureKey: 'real-scam-complaint',
		turns: ['Esto es una estafa?', 'Hace de ayer que estoy esperando'],
		checks: ['human_or_fixed', 'no_promo'],
	},
	{
		key: 'wrong-item-return-followup',
		fixtureKey: 'real-wrong-item-return',
		turns: ['Quisiera saber si me van a realizar la devolucion', 'Orden 24878, el talle dice L y no coincide con la tabla', 'Me responden?'],
		checks: ['human_or_fixed', 'return_followup_copy', 'handoff_suppressed', 'no_duplicate_assistant_reply', 'no_promo', 'no_operational_promise'],
	},
	{
		key: 'wrong-item-return-image-followup',
		fixtureKey: 'real-wrong-item-return',
		turns: ['Quisiera saber si me van a realizar la devolucion', { action: 'simulate_return_image' }, 'Me responden?'],
		checks: ['human_or_fixed', 'return_followup_copy', 'handoff_suppressed', 'no_duplicate_assistant_reply', 'no_promo', 'no_operational_promise'],
	},
	{
		key: 'wrong-color-return-first-contact',
		fixtureKey: 'real-wrong-item-return',
		turns: ['Me llego mal el color, quiero cambiarlo'],
		checks: ['human_or_fixed', 'return_copy', 'no_promo', 'no_operational_promise'],
	},
	{
		key: 'shipping-no-location',
		fixtureKey: 'blank',
		turns: ['Hola, hacen envios?'],
		checks: ['asks_location', 'no_promo', 'no_tracking_invention'],
	},
	{
		key: 'shipping-with-locality',
		fixtureKey: 'blank',
		turns: ['Hacen envios a Rosario, Santa Fe?'],
		checks: ['no_ask_location', 'mentions_shipping_review', 'no_promo'],
	},
	{
		key: 'shipping-with-postal-code',
		fixtureKey: 'blank',
		turns: ['Mi codigo postal es 5000, hacen envios?'],
		checks: ['no_ask_location', 'mentions_shipping_review', 'no_promo'],
	},
	{
		key: 'ambiguous-image-payment',
		fixtureKey: 'real-ambiguous-image-payment',
		turns: ['Asi', { action: 'simulate_empty_signal' }, 'A que numero debo enviar el comprobante?'],
		checks: ['no_payment_verified_claim'],
	},
	{
		key: 'payment-proof-image-classified',
		fixtureKey: 'blank',
		turns: [{ action: 'simulate_payment_image' }],
		checks: ['payment_review_ack', 'payment_review_queue', 'no_payment_verified_claim'],
	},
	{
		key: 'empty-reaction-suppressed',
		fixtureKey: 'real-empty-reaction',
		turns: [{ action: 'simulate_empty_signal' }],
		checks: ['suppressed'],
	},
	{
		key: 'thanks-close-suppressed',
		fixtureKey: 'real-thanks-close',
		turns: ['Gracias'],
		checks: ['suppressed'],
	},
];

function getAssistantMessages(session) {
	return (session?.messages || []).filter((message) => message.role === 'assistant');
}

function latestAssistantText(session) {
	const assistantMessages = getAssistantMessages(session);
	return String(assistantMessages[assistantMessages.length - 1]?.text || '');
}

function normalize(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function evaluateCheck(check, { session, beforeAssistantCount, afterAssistantCount }) {
	const trace = session?.lastTrace || {};
	const text = normalize(latestAssistantText(session));
	const traceText = normalize(trace.assistantMessage || '');
	const combined = `${text} ${traceText}`;

	if (check === 'suppressed') {
		return trace?.provider === 'system' && trace?.model === 'reply-gate' && trace?.shouldReply === false && afterAssistantCount === beforeAssistantCount;
	}

	if (check === 'no_extra_after_thanks') {
		const lastRun = (session?.runs || [])[session.runs.length - 1];
		if (!/gracias/i.test(String(lastRun?.userMessage || ''))) return true;
		return trace?.model === 'reply-gate' && afterAssistantCount === beforeAssistantCount;
	}

	if (check === 'human_or_fixed') {
		return (
			trace?.model === 'reply-gate' ||
			trace?.model === 'human-handoff-router' ||
			trace?.responsePolicy?.action === 'handoff_human' ||
			session?.queue === 'HUMAN'
		);
	}

	if (check === 'no_link') return !/https?:\/\//i.test(combined);
	if (check === 'no_price') return !/\$\s?\d/.test(combined);
	if (check === 'no_wrong_name') return !/\bflor\b|\bmaria\b|\bdebora\b|\bnatalia\b/i.test(combined);
	if (check === 'no_cancel_promise') return !/(ya te cancelo|ya cancelo|cancelamos|anulamos|te cancelo)/i.test(combined);
	if (check === 'no_operational_promise') return !/(ya te cancelo|ya cancelo|cancelamos|anulamos|te cancelo|te confirmo (la )?(devolucion|cancelacion|anulacion|cambio)|queda (cancelado|anulado|aprobado)|reintegro aprobado|devolucion aprobada|cambio aprobado)/i.test(combined);
	if (check === 'no_tracking_invention') {
		if (trace?.liveOrderContext?.trackingUrl || trace?.liveOrderContext?.trackingNumber) return true;
		return !/(tracking|codigo de seguimiento|seguirlo aca|link de seguimiento)/i.test(combined);
	}
	if (check === 'no_promo') return !/(promo|oferta|3x1|5x2|2x1|calzas linfaticas|pack)/i.test(combined);
	if (check === 'no_payment_verified_claim') return !/(ya lo revise|estoy revisando|verificamos el pago|se acredito|se acredito)/i.test(combined);
	if (check === 'no_unconfirmed_catalog_claim') return !/(tenemos stock|viene en xl|te confirmo xl|sin problema en xl)/i.test(combined);
	if (check === 'asks_location') return /(decime|pasame|indicame|confirmame|mandame).*(localidad|codigo postal|cp|zona|provincia)/i.test(combined);
	if (check === 'no_ask_location') return !/(decime|pasame|indicame|confirmame|mandame).*(localidad|codigo postal|cp|zona|provincia)/i.test(combined);
	if (check === 'mentions_shipping_review') return /(con ese dato|lo revisamos|opciones disponibles|hacemos envios|envios)/i.test(combined);
	if (check === 'return_copy') return /(asesora|humano|equipo).*(caso|revis)|numero de pedido|foto|etiqueta|derivad/i.test(combined);
	if (check === 'return_followup_copy') return /(sumo ese dato|sumo la foto|queda derivado|foto del producto|etiqueta|acelerar la revision)/i.test(combined);
	if (check === 'tracking_followup_copy') return /(seguimiento cargado|no avanza|cambiar un dato del envio|asesora|caso derivado)/i.test(combined);
	if (check === 'payment_review_ack') return /(recibimos el comprobante|revision de pago|verificado)/i.test(combined);
	if (check === 'payment_review_queue') return session?.queue === 'PAYMENT_REVIEW' || trace?.model === 'payment-proof-router';
	if (check === 'handoff_suppressed') {
		return trace?.model === 'reply-gate' && trace?.shouldReply === false && afterAssistantCount === beforeAssistantCount;
	}
	if (check === 'no_duplicate_assistant_reply') {
		const assistantMessages = getAssistantMessages(session)
			.map((message) => normalize(message.text || message.body || ''))
			.filter(Boolean);
		if (assistantMessages.length < 2) return true;
		return assistantMessages[assistantMessages.length - 1] !== assistantMessages[assistantMessages.length - 2];
	}

	return true;
}

async function runScenario(scenario) {
	let session = await createAiLabSession({
		workspaceId: WORKSPACE_ID,
		fixtureKey: scenario.fixtureKey,
	});

	for (const turn of scenario.turns) {
		const beforeAssistantCount = getAssistantMessages(session).length;
		session = await sendAiLabMessage(session.id, {
			workspaceId: WORKSPACE_ID,
			body: typeof turn === 'string' ? turn : '',
			action: typeof turn === 'object' ? turn.action || '' : '',
			selectionId: typeof turn === 'object' ? turn.selectionId || '' : '',
		});
		const afterAssistantCount = getAssistantMessages(session).length;
		session._lastTurnCounts = { beforeAssistantCount, afterAssistantCount };
	}

	const results = scenario.checks.map((check) => ({
		check,
		pass: evaluateCheck(check, {
			session,
			beforeAssistantCount: session._lastTurnCounts?.beforeAssistantCount ?? 0,
			afterAssistantCount: session._lastTurnCounts?.afterAssistantCount ?? 0,
		}),
	}));

	return {
		key: scenario.key || scenario.fixtureKey,
		fixtureKey: scenario.fixtureKey,
		sessionId: session.id,
		conversationId: session.conversationId,
		provider: session.lastTrace?.provider || '',
		model: session.lastTrace?.model || '',
		intent: session.lastTrace?.intent || '',
		action: session.lastTrace?.responsePolicy?.action || '',
		reply: session.lastTrace?.assistantMessage || latestAssistantText(session),
		results,
		pass: results.every((result) => result.pass),
	};
}

try {
	const selected = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
	const scenarios = selected.length
		? SCENARIOS.filter((scenario) => selected.includes(scenario.key || scenario.fixtureKey) || selected.includes(scenario.fixtureKey))
		: SCENARIOS;

	const results = [];
	for (const scenario of scenarios) {
		results.push(await runScenario(scenario));
	}

	const failures = results.filter((result) => !result.pass);
	console.log(JSON.stringify({
		workspaceId: WORKSPACE_ID,
		provider: process.env.AI_PROVIDER || 'gemini',
		geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
		total: results.length,
		passed: results.length - failures.length,
		failed: failures.length,
		results,
	}, null, 2));

	process.exitCode = failures.length ? 1 : 0;
} finally {
	await prisma.$disconnect();
}
