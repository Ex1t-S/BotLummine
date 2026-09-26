const STOP_WORDS = new Set([
	'a', 'al', 'algo', 'así', 'asi', 'con', 'de', 'del', 'el', 'en', 'es', 'la', 'las',
	'lo', 'los', 'me', 'mi', 'mis', 'para', 'por', 'que', 'se', 'su', 'sus', 'te',
	'tu', 'tus', 'un', 'una', 'y', 'ya', 'yo'
]);

export function normalizeComparableText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/https?:\/\/\S+/g, ' url ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function meaningfulTokens(value = '') {
	return new Set(
		normalizeComparableText(value)
			.split(' ')
			.filter((token) => token.length > 2 && !STOP_WORDS.has(token))
	);
}

export function responseSimilarity(left = '', right = '') {
	const normalizedLeft = normalizeComparableText(left);
	const normalizedRight = normalizeComparableText(right);
	if (!normalizedLeft || !normalizedRight) return 0;
	if (normalizedLeft === normalizedRight) return 1;

	const leftTokens = meaningfulTokens(left);
	const rightTokens = meaningfulTokens(right);
	if (!leftTokens.size || !rightTokens.size) return 0;

	let intersection = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) intersection += 1;
	}
	return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function previousUserMessage(recentMessages = [], latestUserMessage = '') {
	const latest = normalizeComparableText(latestUserMessage);
	const users = recentMessages.filter((message) => message?.role === 'user');
	if (!users.length) return null;
	const last = users[users.length - 1];
	if (latest && normalizeComparableText(last.text) === latest) {
		return users.length > 1 ? users[users.length - 2] : null;
	}
	return last;
}

export function isRepeatedUserMessage({ recentMessages = [], latestUserMessage = '' } = {}) {
	const previous = previousUserMessage(recentMessages, latestUserMessage);
	if (!previous || !latestUserMessage) return false;
	return responseSimilarity(previous.text, latestUserMessage) >= 0.86;
}

export function findRepeatedAssistantReply({
	text = '',
	recentMessages = [],
	latestUserMessage = '',
	minSimilarity = 0.84,
	} = {}) {
	if (!text || isRepeatedUserMessage({ recentMessages, latestUserMessage })) {
		return { repeated: false, similarity: 0, previous: null };
	}

	const assistantMessages = recentMessages
		.filter((message) => message?.role === 'assistant' && String(message.text || '').trim())
		.slice(-5);
	let best = { similarity: 0, previous: null };
	for (const message of assistantMessages) {
		const similarity = responseSimilarity(text, message.text);
		if (similarity > best.similarity) best = { similarity, previous: message.text };
	}

	return {
		repeated: best.similarity >= minSimilarity,
		similarity: best.similarity,
		previous: best.previous,
	};
}

export function buildContinuityRecoveryReply({ responsePolicy = {}, latestUserMessage = '' } = {}) {
	const action = String(responsePolicy?.action || '');
	const text = normalizeComparableText(latestUserMessage);

	if (action.includes('payment')) {
		return '¿Querés pagar por transferencia o tarjeta? Te indico el próximo paso.';
	}
	if (action.includes('shipping')) {
		return 'Decime tu localidad o código postal y revisamos el envío puntual.';
	}
	if (action.includes('size')) {
		return '¿Qué producto estás viendo y qué talle usás normalmente?';
	}
	if (action.includes('order_status')) {
		return 'Pasame el número de pedido y te confirmo el estado.';
	}
	if (/\b(no|pero|ya te dije|eso no|no quiero|no me sirve|incorrect)/i.test(text)) {
		return 'Entiendo la corrección. Tomo ese dato y seguimos desde ahí; decime qué punto querés resolver ahora.';
	}
	return 'Tomo tu consulta puntual. Decime qué dato falta confirmar y lo revisamos.';
}

export function buildConversationContinuityBlock({
	latestUserMessage = '',
	recentMessages = [],
	responsePolicy = {},
} = {}) {
	const previous = previousUserMessage(recentMessages, latestUserMessage);
	const repeatedUser = isRepeatedUserMessage({ recentMessages, latestUserMessage });
	const lines = [
		'- Responde al ultimo mensaje del cliente; no retomes una pregunta anterior si ya fue contestada.',
		'- Si el cliente corrige, rechaza o agrega un dato, reconocelo brevemente y usa el dato nuevo.',
		'- No repitas una respuesta, precio, promo, link o pregunta ya enviada salvo que el cliente la pida de forma explicita.',
		'- Si no podés avanzar con los datos confirmados, hace una sola pregunta concreta o deriva; no encadenes preguntas genericas.',
	];
	if (previous && !repeatedUser) lines.push(`- El cliente ya habia dicho: ${String(previous.text || '').slice(0, 180)}`);
	if (responsePolicy?.action) lines.push(`- El siguiente paso debe respetar la accion: ${responsePolicy.action}.`);
	return `CONDUCCION DE LA CONVERSACION:\n${lines.join('\n')}`;
}
