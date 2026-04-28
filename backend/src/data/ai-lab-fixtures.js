export const AI_LAB_FIXTURES = [
	{
		key: 'blank',
		name: 'En blanco',
		description: 'Arranca desde cero, sin historial ni estado previo.',
		expected: ['La IA deberia sonar como en WhatsApp real', 'Util para validar saludos, tono y cierre']
	},
	{
		key: 'body-discovery',
		name: 'Producto desde cero',
		description: 'Deja solo el saludo inicial para probar descubrimiento de producto.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asistente de la marca. En que puedo ayudarte hoy?'
			}
		],
		expected: [
			'No deberia volver a saludar en el segundo turno',
			'No deberia fijar un producto puntual demasiado temprano'
		]
	},
	{
		key: 'body-black-xl',
		name: 'Producto con talle/color',
		description: 'Parte con color y talle ya definidos para probar foco y link.',
		stateOverrides: {
			customerName: 'German',
			interestedProducts: ['body modelador'],
			currentProductFocus: 'body modelador',
			frequentSize: 'XL',
			salesStage: 'SIZE_COLOR_CHECK'
		},
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asistente de la marca. En que puedo ayudarte hoy?'
			},
			{
				direction: 'INBOUND',
				body: 'Busco un body modelador negro en XL'
			}
		],
		expected: [
			'Si pide link, deberia mandar uno coherente',
			'No deberia mezclar promos si ya quedo claro el foco'
		]
	},
	{
		key: 'payment-followup',
		name: 'Seguimiento de pago',
		description: 'Sirve para validar transferencia, comprobante y continuidad.',
		stateOverrides: {
			customerName: 'German',
			interestedProducts: ['body modelador'],
			currentProductFocus: 'body modelador',
			paymentPreference: 'transferencia',
			salesStage: 'READY_TO_BUY'
		},
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Te paso el link del producto y, si queres, despues te ayudo con el pago.'
			}
		],
		expected: [
			'Deberia responder igual que WhatsApp cuando preguntan por transferencia',
			'No deberia volver al saludo inicial'
		]
	},
	{
		key: 'soft-menu-discovery',
		name: 'Descubrimiento con menu blando',
		description: 'Sirve para ver si la IA guia sin clavar el menu interactivo al primer turno.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asistente de la marca. En que puedo ayudarte hoy?'
			}
		],
		expected: [
			'No deberia forzar menu interactivo automaticamente',
			'Puede sugerir opciones de ayuda dentro de la respuesta si suma claridad',
			'El trace deberia mostrar menuAssistantContext'
		]
	},
	{
		key: 'buyer-menu-flow',
		name: 'Menu comprador real',
		description: 'Carga el menu comprador real para probar selecciones y cambios bruscos de tema.',
		startWithMainMenu: true,
		menuPath: 'MAIN_MENU',
		menuIntroText: 'Simulacion AI LAB: este es el menu que veria la compradora.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asistente de la marca. Te ayudo por aca.'
			}
		],
		expected: [
			'Deberias poder tocar opciones reales del menu desde AI LAB',
			'Si la clienta cambia de tema fuerte, la IA no deberia quedar atrapada en el menu',
			'La seleccion de menu deberia orientar familia, soporte o postventa segun el caso'
		]
	}
];

export function getAiLabFixture(fixtureKey = 'blank') {
	return AI_LAB_FIXTURES.find((fixture) => fixture.key === fixtureKey) || AI_LAB_FIXTURES[0];
}
