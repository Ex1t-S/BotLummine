export const AI_LAB_FIXTURES = [
	{
		key: 'blank',
		name: 'Sesión vacía',
		description: 'Arranca desde cero para probar saludos, descubrimiento y cierre.',
		contactName: 'German',
		customerContext: {
			name: 'German',
			waId: '5492923562286'
		},
		messages: [],
		expected: [
			'No debería saludar dos veces.',
			'No debería mandar link ni promo cerrada demasiado temprano.'
		]
	},
	{
		key: 'body-modelador-inicio',
		name: 'Body modelador desde cero',
		description: 'Escenario para validar que la IA oriente antes de clavar una promo.',
		contactName: 'German',
		customerContext: {
			name: 'German',
			waId: '5492923562286'
		},
		messages: [
			{ role: 'user', text: 'Hola' },
			{ role: 'assistant', text: 'Hola, soy Sofi de Lummine. Te ayudo con lo que necesites 😊' },
			{ role: 'user', text: 'Quiero comprar un body modelador' }
		],
		expected: [
			'No debería arrancar con un link.',
			'No debería elegir una promo cerrada si todavía no hay color o talle.',
			'Debería orientar de forma humana y pedir un dato útil.'
		]
	},
	{
		key: 'body-modelador-link-bug',
		name: 'Caso real de link equivocado',
		description: 'Reproduce la charla donde la IA mezcla TOTAL WHITE con 3x1 negro XL.',
		contactName: 'German',
		customerContext: {
			name: 'German',
			waId: '5492923562286'
		},
		messages: [
			{ role: 'user', text: 'Hola' },
			{ role: 'assistant', text: 'Hola, soy Sofi de Lummine. Te ayudo con lo que necesites 😊' },
			{ role: 'user', text: 'Quiero comprar un body modelador' },
			{ role: 'assistant', text: 'Tenemos varias opciones en body modeladores. Si querés, te guío según color, talle o la promo que más te convenga.' },
			{ role: 'user', text: 'Tienen en otro color q no sea blanco? Porque esa promo es solo blanco' },
			{ role: 'assistant', text: 'Sí, trabajamos también otras opciones. Si buscabas negro y querés seguir por esa línea, te digo cuál conviene mejor.' },
			{ role: 'user', text: 'Y el 3x1 lo tienen en negro y XL?' },
			{ role: 'assistant', text: 'Sí, en negro y XL trabajamos esa opción. Si querés seguimos con esa.' },
			{ role: 'user', text: 'Dale pásame aceptan transferencia?' },
			{ role: 'assistant', text: 'Sí, aceptamos transferencia. Si querés cerramos con esa opción y después te paso el link correcto.' },
			{ role: 'user', text: 'Transferencia' },
			{ role: 'assistant', text: 'Perfecto. Si querés, seguimos con el 3x1 en negro y XL.' },
			{ role: 'user', text: 'Nada más me pasas el link?' }
		],
		expected: [
			'Solo debería mandar un link.',
			'El link tiene que coincidir con la promo que se vino trabajando.',
			'No debería volver a TOTAL WHITE si ya quedó enfocada otra opción.'
		]
	},
	{
		key: 'pedido-humano',
		name: 'Cliente pide humano',
		description: 'Sirve para validar el handoff sin romper el tono.',
		contactName: 'Magali',
		customerContext: {
			name: 'Magali',
			waId: '5491122233344'
		},
		messages: [
			{ role: 'user', text: 'Hola, hice un pedido y quiero hablar con una persona' }
		],
		expected: [
			'Debería derivar con calidez.',
			'No debería seguir ofreciendo productos.'
		]
	}
];

export function getAiLabFixture(key = 'blank') {
	return AI_LAB_FIXTURES.find((fixture) => fixture.key === key) || AI_LAB_FIXTURES[0];
}
