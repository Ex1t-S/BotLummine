import { normalizeText, overlapScore } from '../lib/text.js';

const BASE_FACTS = [
	'Lummine es una tienda online argentina de indumentaria y prendas modeladoras.',
	'La atención por WhatsApp debe sentirse humana, cercana, ágil y natural.',
	'El objetivo principal es orientar, resolver dudas simples y acompañar la compra sin sonar invasiva ni automática.',
	'No hay que repetir saludos, nombre del cliente ni fórmulas comerciales en todos los mensajes.',
	'No hay que hablar como bot, asistente virtual ni IA.',
	'En una conversación ya iniciada, la respuesta debe continuar el hilo sin volver a empezar de cero.',
	'Si la clienta ya viene hablando de un producto, no hay que volver a preguntar cuál es salvo que realmente no esté claro.',
	'No hay que mandar al link para sacarse una duda simple si la respuesta ya está disponible en el contexto o catálogo.'
];

const TOPIC_FACTS = {
	envios: [
		'Si preguntan por envío, responder claro, simple y directo.',
		'Si falta ubicación, pedir zona, localidad o provincia sin cortar el hilo.'
	],
	pagos: [
		'Si preguntan por medios de pago o promos, ahí sí se pueden mencionar cuotas o descuento por transferencia.',
		'Si la clienta ya está decidida, ayudar a orientar el siguiente paso sin forzar el cierre.'
	],
	talles: [
		'Si preguntan por talle y ya hay un producto claro en la conversación, responder sobre ese producto sin reiniciar.',
		'Pedir una referencia de talle solo si realmente hace falta para orientar mejor.'
	],
	stock: [
		'Si preguntan por color o talle dentro de una conversación de compra, responder como continuidad del producto actual.',
		'No derivar al sitio para verificar disponibilidad si la venta se puede orientar por WhatsApp.',
		'Si hay stock no volver a recomendar el producto, sino continuar con la conversación como si ya se hubiera decidido por ese producto.',
		'Si preguntan por stock, siempre hay pero no menciona antes de que lo pregunten'
	],
	pedidos: [
		'Si preguntan por pedido y hay señales de postventa, pedir número de orden o dato de seguimiento.',
		'Si dicen "armar el pedido", "hacer el pedido" o "cerrar el pedido" dentro de una charla comercial, interpretarlo como intención de compra.'
	],
	productos: [
		'Si preguntan por un producto, responder de forma concreta, útil y orientada a avanzar.',
		'No recitar el catálogo entero si no lo pidieron.'
	]
};

export const STYLE_EXAMPLES = [
	{
		tags: ['saludo', 'inicio', 'primer mensaje'],
		customer: 'Hola',
		agent: '¡Hola! Soy Sofi de Lummine 😊 ¿En qué te ayudo?'
	},
	{
		tags: ['continuidad', 'producto'],
		customer: 'Tenes en negro?',
		agent: 'Sí 😊 Lo tenemos en negro.'
	},
	{
		tags: ['continuidad', 'talle'],
		customer: 'Y talle XL tienen?',
		agent: 'Sí, trabajamos XL/XXL 😊'
	},
	{
		tags: ['precio', 'producto'],
		customer: 'Del 3x1 precio y talles y color',
		agent: 'Sí 😊 Te cuento precio, talles y colores del 3x1.'
	},
	{
		tags: ['link', 'continuidad'],
		customer: 'Me pasas el link?',
		agent: 'Sí, obvio 😊 Te lo paso por acá.'
	},
	{
		tags: ['pedido compra', 'orientacion'],
		customer: 'Armamos el pedido entonces',
		agent: 'Sí, dale 😊 Te paso el link así seguís desde ahí.'
	},
	{
		tags: ['postventa', 'seguimiento'],
		customer: 'Quiero saber el estado de mi pedido',
		agent: 'Dale, pasame tu número de orden y te lo revisamos.'
	},
	{
		tags: ['mensaje corto', 'seguimiento natural'],
		customer: 'Y en beige?',
		agent: 'Sí, también viene en beige 😊'
	}
];

function latestUserMessage(recentMessages = []) {
	const reversed = [...recentMessages].reverse();
	return reversed.find((item) => item.role === 'user')?.text || '';
}

function detectTopics(text = '') {
	const normalized = normalizeText(text);
	const topics = new Set();

	if (/(envio|enviar|correo|oca|andreani|interior|provincia|pais|gratis)/.test(normalized)) topics.add('envios');
	if (/(pago|transferencia|tarjeta|cuota|cuotas|descuento|promo|promocion|promoción)/.test(normalized)) topics.add('pagos');
	if (/(talle|medida|medidas|m\/l|xl\/xxl|xl|xxl|110)/.test(normalized)) topics.add('talles');
	if (/(stock|disponible|queda|color|colores|negro|beige|blanco)/.test(normalized)) topics.add('stock');
	if (/(pedido|orden|seguimiento|llego|llegó|demora)/.test(normalized)) topics.add('pedidos');
	if (/(body|bodys|corpiño|corpino|bombacha|musculosa|calza|faja|short|conjunto)/.test(normalized)) topics.add('productos');

	return [...topics];
}

export function getRelevantStoreFacts(recentMessages = []) {
	const lastUserText = latestUserMessage(recentMessages);
	const topics = detectTopics(lastUserText);

	const result = [...BASE_FACTS];

	for (const topic of topics) {
		const topicFacts = TOPIC_FACTS[topic] || [];
		for (const fact of topicFacts) {
			if (!result.includes(fact)) result.push(fact);
		}
	}

	return result.slice(0, 10);
}

export function getRelevantStyleExamples(recentMessages = [], limit = 4) {
	const lastUserText = latestUserMessage(recentMessages);

	const ranked = STYLE_EXAMPLES
		.map((example) => {
			const haystack = `${example.tags.join(' ')} ${example.customer} ${example.agent}`;
			return {
				example,
				score: overlapScore(lastUserText, haystack)
			};
		})
		.sort((a, b) => b.score - a.score);

	const filtered = ranked
		.filter((item) => item.score > 0)
		.slice(0, limit)
		.map((item) => item.example);

	if (filtered.length) return filtered;

	return STYLE_EXAMPLES.slice(0, limit);
}

export function buildHeuristicSummary(messages = []) {
	const inbound = messages
		.filter((msg) => msg.direction === 'INBOUND')
		.map((msg) => msg.body)
		.filter(Boolean);

	const topics = detectTopics(inbound.slice(-4).join(' '));
	const lastInbound = inbound.slice(-3).join(' | ');

	const parts = [];

	if (topics.length) {
		parts.push(`Temas recientes: ${topics.join(', ')}.`);
	}

	if (lastInbound) {
		parts.push(`Últimos mensajes del cliente: ${lastInbound.slice(0, 220)}.`);
	}

	return parts.join(' ').trim().slice(0, 500);
}