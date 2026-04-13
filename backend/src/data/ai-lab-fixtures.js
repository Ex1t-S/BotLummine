export const AI_LAB_FIXTURES = [
	{
		key: 'blank',
		name: 'En blanco',
		description: 'Arranca desde cero, sin historial ni estado previo.',
		expected: ['La IA debería sonar como en WhatsApp real', 'Útil para validar saludos, tono y cierre']
	},
	{
		key: 'body-discovery',
		name: 'Body modelador desde cero',
		description: 'Deja solo el saludo inicial para probar descubrimiento de producto.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: '¡Hola! Soy Sofi de Lummine. ¿En qué puedo ayudarte hoy?'
			}
		],
		expected: [
			'No debería volver a saludar en el segundo turno',
			'No debería fijar un producto puntual demasiado temprano'
		]
	},
	{
		key: 'body-black-xl',
		name: 'Body negro XL',
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
				body: '¡Hola! Soy Sofi de Lummine. ¿En qué puedo ayudarte hoy?'
			},
			{
				direction: 'INBOUND',
				body: 'Busco un body modelador negro en XL'
			}
		],
		expected: [
			'Si pide link, debería mandar uno coherente',
			'No debería mezclar promos si ya quedó claro el foco'
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
				body: 'Te paso el link del body modelador y, si querés, después te ayudo con el pago.'
			}
		],
		expected: [
			'Debería responder igual que WhatsApp cuando preguntan por transferencia',
			'No debería volver al saludo inicial'
		]
	},
	{
		key: 'soft-menu-discovery',
		name: 'Descubrimiento con menú blando',
		description: 'Sirve para ver si la IA guía sin clavar el menú interactivo al primer turno.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: '¡Hola! Soy Sofi de Lummine. ¿En qué puedo ayudarte hoy?'
			}
		],
		expected: [
			'No debería forzar menú interactivo automáticamente',
			'Puede sugerir opciones de ayuda dentro de la respuesta si suma claridad',
			'El trace debería mostrar menuAssistantContext'
		]
	}
];

export function getAiLabFixture(fixtureKey = 'blank') {
	return AI_LAB_FIXTURES.find((fixture) => fixture.key === fixtureKey) || AI_LAB_FIXTURES[0];
}
