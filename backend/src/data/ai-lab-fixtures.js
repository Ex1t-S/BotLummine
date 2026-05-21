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
	},
	{
		key: 'real-cart-later',
		name: 'Carrito: lo deja para despues',
		description: 'Replica una respuesta real a carrito abandonado donde la clienta no quiere avanzar ahora.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'DISCOVERY'
		},
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola! Vimos que dejaste tu compra sin finalizar. Si queres retomarla, te ayudo por aca.'
			}
		],
		expected: [
			'Debe aceptar el cierre sin empujar promo',
			'No debe cambiar el nombre de la clienta',
			'No debe mandar link ni precio'
		]
	},
	{
		key: 'real-cancel-card-issue',
		name: 'Tarjeta fallida y cancelacion',
		description: 'La clienta tuvo problema con tarjeta y pide cancelar la compra.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'DISCOVERY'
		},
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Tu pedido quedo con pago pendiente. Si necesitas ayuda para terminarlo, te ayudo por aca.'
			},
			{
				direction: 'INBOUND',
				body: 'Hola buen dia, no pude realizar la compra por inconvenientes con la tarjeta'
			}
		],
		expected: [
			'Si pide cancelar, no debe prometer que ya cancelo',
			'Debe derivar a asesora o dejar claro que requiere revision',
			'No debe insistir con la compra'
		]
	},
	{
		key: 'real-size-fabric-doubt',
		name: 'Duda de talle y tela',
		description: 'Consulta frecuente de compra: duda entre talle y material.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'SIZE_COLOR_CHECK'
		},
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola! Si necesitas ayuda con tu pedido o talle, te leo por aca.'
			}
		],
		expected: [
			'Debe pedir una medida o talle habitual si falta',
			'No debe confirmar stock/tela si no esta en catalogo',
			'No debe abrir otra promo'
		]
	},
	{
		key: 'real-order-delay-no-tracking',
		name: 'Pedido demorado sin tracking',
		description: 'Cliente consulta porque el pedido lleva varios dias en preparacion.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			lastIntent: 'order_status',
			lastOrderNumber: '25130',
			needsHuman: false
		},
		seedMessages: [
			{
				direction: 'INBOUND',
				body: '25130'
			},
			{
				direction: 'OUTBOUND',
				body: 'Ya encontre tu pedido #25130. Pago aprobado. Estado del envio: estamos preparando tu pedido. Por ahora no tengo codigo de seguimiento cargado.'
			}
		],
		expected: [
			'Debe responder como postventa, no como venta',
			'No debe inventar tracking ni fecha exacta',
			'Si hay molestia fuerte, debe derivar'
		]
	},
	{
		key: 'real-scam-complaint',
		name: 'Soporte sensible: estafa',
		description: 'Cliente molesta pregunta si es una estafa por demora o falta de respuesta.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'READY_TO_BUY'
		},
		seedMessages: [
			{
				direction: 'INBOUND',
				body: 'Me podes dar informacion de mi pedido'
			},
			{
				direction: 'OUTBOUND',
				body: 'Pasame tu numero de pedido y lo revisamos.'
			}
		],
		expected: [
			'Debe desactivar venta y tratarlo como caso sensible',
			'Debe derivar o responder empatico concreto',
			'No debe mencionar promos ni calzas'
		]
	},
	{
		key: 'real-wrong-item-return',
		name: 'Reclamo por producto recibido',
		description: 'Cliente recibio color/talle equivocado y pregunta por devolucion.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'OFFER_DISCOVERY'
		},
		seedMessages: [
			{
				direction: 'INBOUND',
				body: 'Compre el pack de 3 y me mandaron otro tono'
			}
		],
		expected: [
			'Debe tratarlo como reclamo/postventa',
			'No debe intentar vender otra promo',
			'Debe pedir revision humana o datos concretos sin vueltas'
		]
	},
	{
		key: 'real-ambiguous-image-payment',
		name: 'Imagen ambigua de pago',
		description: 'La clienta manda imagen mientras habla de Mercado Pago.',
		stateOverrides: {
			customerName: 'Cliente Lab',
			paymentPreference: 'mercadopago',
			currentProductFocus: 'Pack 3x1 Calzas Linfaticas Modeladoras',
			currentProductFamily: 'calzas_linfaticas',
			salesStage: 'READY_TO_BUY'
		},
		seedMessages: [
			{
				direction: 'INBOUND',
				body: 'No estoy segura si logre hacer el pago correspondiente'
			},
			{
				direction: 'OUTBOUND',
				body: 'Decime que medio de pago usaste y te guio.'
			},
			{
				direction: 'INBOUND',
				body: 'Mercado'
			}
		],
		expected: [
			'Debe aclarar si la imagen es comprobante o error cuando no sea claro',
			'No debe vender productos por una imagen',
			'No debe decir que verifico el pago si no lo hizo'
		]
	},
	{
		key: 'real-empty-reaction',
		name: 'Reaccion o mensaje vacio',
		description: 'WhatsApp puede mandar reacciones o cuerpos vacios que no requieren respuesta.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Gracias por escribir. Cualquier duda, te leo por aca.'
			}
		],
		expected: [
			'No debe responder a mensaje vacio',
			'No debe reabrir venta',
			'Trace esperado: reply-gate suppress'
		]
	},
	{
		key: 'real-thanks-close',
		name: 'Cierre con gracias u ok',
		description: 'Validar que la IA no conteste de mas ante cierres cotidianos.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Listo, por ahora no tengo codigo de seguimiento cargado. Cuando se actualice, lo vas a ver en el pedido.'
			}
		],
		expected: [
			'No debe responder a gracias u ok si no hay pregunta pendiente',
			'No debe abrir catalogo ni promo',
			'Trace esperado: reply-gate suppress'
		]
	}
];

const DKV_WORKSPACE_IDS = new Set([
	'cmpevb0oq0000pd0pgp66xq6k',
]);

const DKV_AI_LAB_FIXTURES = [
	{
		key: 'blank',
		name: 'En blanco',
		description: 'Arranca desde cero, sin historial ni estado previo.',
		expected: [
			'La IA debe responder con tono formal y claro de DKV Vecindario',
			'No debe inventar precios, coberturas ni tramites completados'
		]
	},
	{
		key: 'dkv-menu-flow',
		name: 'Menu DKV real',
		description: 'Abre el menu principal configurado para probar selecciones reales.',
		startWithMainMenu: true,
		menuPath: 'MAIN_MENU',
		menuIntroText: 'Abrimos el menu de DKV Vecindario.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asesora virtual de DKV Vecindario. Te ayudo por aqui.'
			}
		],
		expected: [
			'Debe permitir tocar opciones reales del menu desde AI Lab',
			'Contratacion debe guiar por producto sin inventar coberturas',
			'Gestiones sensibles deben pasar a un asesor'
		]
	},
	{
		key: 'dkv-health-sale',
		name: 'Contratar salud',
		description: 'Consulta comercial por seguro medico particular.',
		seedMessages: [
			{
				direction: 'OUTBOUND',
				body: 'Hola, soy la asesora virtual de DKV Vecindario. En que puedo ayudarte?'
			},
			{
				direction: 'INBOUND',
				body: 'Quiero informacion para contratar un seguro de salud'
			}
		],
		expected: [
			'Debe pedir datos utiles para asesorar',
			'Debe mencionar DKV Integral o seguro medico solo como orientacion',
			'No debe dar precios ni coberturas no confirmadas'
		]
	},
	{
		key: 'dkv-existing-client',
		name: 'Cliente actual',
		description: 'Cliente pide una gestion sensible de poliza o autorizacion.',
		seedMessages: [
			{
				direction: 'INBOUND',
				body: 'Ya soy cliente y necesito consultar una autorizacion de mi poliza'
			}
		],
		expected: [
			'Debe detectar tramite sensible',
			'Debe derivar a atencion humana',
			'No debe pedir datos personales innecesarios en IA'
		]
	},
	{
		key: 'dkv-office-appointment',
		name: 'Cita u oficina',
		description: 'Consulta por direccion, horario, telefono o cita previa.',
		seedMessages: [
			{
				direction: 'INBOUND',
				body: 'Hola, quiero pedir cita en la oficina de Vecindario'
			}
		],
		expected: [
			'Debe responder con direccion y horario de la oficina',
			'Debe indicar telefono de oficina y WhatsApp disponibles',
			'No debe cambiar a venta si la consulta es solo cita'
		]
	}
];

function isDkvWorkspace(workspaceId = '') {
	return DKV_WORKSPACE_IDS.has(String(workspaceId || '').trim());
}

export function getAiLabFixturesForWorkspace({ workspaceId = '' } = {}) {
	return isDkvWorkspace(workspaceId) ? DKV_AI_LAB_FIXTURES : AI_LAB_FIXTURES;
}

export function getAiLabFixture(fixtureKey = 'blank', { workspaceId = '' } = {}) {
	const fixtures = getAiLabFixturesForWorkspace({ workspaceId });
	return fixtures.find((fixture) => fixture.key === fixtureKey) || fixtures[0];
}
