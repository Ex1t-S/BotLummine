import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { DEFAULT_WORKSPACE_ID, getWorkspaceRuntimeConfig, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';
import {
	AI_PROFILES,
	getAiVerticalProfile,
	resolveAiProfile,
	usesCommerceEngine,
} from '../ai/vertical-profile.service.js';

export const DEFAULT_MENU_PATHS = {
	MAIN: 'MAIN_MENU',
	PRODUCTS: 'PRODUCTS_MENU',
	ORDERS: 'ORDERS_MENU',
	SUPPORT: 'SUPPORT_MENU'
};

export const DEFAULT_MAIN_MENU_KEY = DEFAULT_MENU_PATHS.MAIN;
const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 15000;

const runtimeCacheByWorkspace = new Map();

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}

function normalizeText(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLooseText(value = '') {
	return normalizeText(value)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

function asArray(value) {
	return Array.isArray(value) ? value : [];
}

function hasOwn(object, key) {
	return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

function buildFallbackText(menu) {
	const lines = [];
	const title = normalizeText(menu.fallbackTitle || menu.title || menu.headerText || 'Menú');

	if (title) {
		lines.push(`*${title}*`);
	}

	for (const option of asArray(menu.options)) {
		if (!option?.isActive) continue;
		const numericAlias = asArray(option.aliases).find((alias) => /^\d+$/.test(String(alias || '').trim()));
		const prefix = numericAlias ? `${numericAlias}- ` : '• ';
		lines.push(`${prefix}${normalizeText(option.title)}`);
	}

	if (normalizeText(menu.footerText)) {
		lines.push('');
		lines.push(normalizeText(menu.footerText));
	}

	return lines.join('\n');
}

function normalizeOption(rawOption = {}, fallbackOption = {}, index = 0) {
	const id = normalizeText(rawOption.id || fallbackOption.id || `menu_option_${index + 1}`);
	const aliasSource = hasOwn(rawOption, 'aliases') ? rawOption.aliases : fallbackOption.aliases;
	const aliases = asArray(aliasSource).map((value) => normalizeText(value)).filter(Boolean);

	const option = {
		id,
		title: normalizeText(hasOwn(rawOption, 'title') ? rawOption.title : (fallbackOption.title || `Opción ${index + 1}`)),
		description: normalizeText(hasOwn(rawOption, 'description') ? rawOption.description : (fallbackOption.description || '')),
		aliases: [...new Set(aliases)],
		actionType: normalizeText(hasOwn(rawOption, 'actionType') ? rawOption.actionType : (fallbackOption.actionType || 'MESSAGE')).toUpperCase(),
		actionValue: normalizeText(hasOwn(rawOption, 'actionValue') ? rawOption.actionValue : (fallbackOption.actionValue || '')),
		promptPrefix: normalizeText(hasOwn(rawOption, 'promptPrefix') ? rawOption.promptPrefix : (fallbackOption.promptPrefix || '')),
		replyBody: normalizeText(hasOwn(rawOption, 'replyBody') ? rawOption.replyBody : (fallbackOption.replyBody || '')),
		effectiveMessageBody: normalizeText(hasOwn(rawOption, 'effectiveMessageBody') ? rawOption.effectiveMessageBody : (fallbackOption.effectiveMessageBody || '')),
		summaryUserMessage: normalizeText(hasOwn(rawOption, 'summaryUserMessage') ? rawOption.summaryUserMessage : (fallbackOption.summaryUserMessage || '')),
		handoffReason: normalizeText(hasOwn(rawOption, 'handoffReason') ? rawOption.handoffReason : (fallbackOption.handoffReason || '')),
		model: normalizeText(hasOwn(rawOption, 'model') ? rawOption.model : (fallbackOption.model || '')),
		statePatch: typeof rawOption.statePatch === 'object' && rawOption.statePatch !== null
			? rawOption.statePatch
			: (typeof fallbackOption.statePatch === 'object' && fallbackOption.statePatch !== null ? fallbackOption.statePatch : {}),
		isActive: rawOption.isActive !== undefined ? Boolean(rawOption.isActive) : (fallbackOption.isActive !== undefined ? Boolean(fallbackOption.isActive) : true),
		sortOrder: Number.isFinite(Number(rawOption.sortOrder))
			? Number(rawOption.sortOrder)
			: (Number.isFinite(Number(fallbackOption.sortOrder)) ? Number(fallbackOption.sortOrder) : index + 1)
	};

	return option;
}

function normalizeMenu(rawMenu = {}, fallbackMenu = {}, index = 0) {
	const key = normalizeText(rawMenu.key || fallbackMenu.key || `MENU_${index + 1}`);
	const fallbackOptions = asArray(fallbackMenu.options);
	const rawOptions = asArray(rawMenu.options);
	const fallbackOptionById = Object.fromEntries(fallbackOptions.map((option) => [option.id, option]));

	const optionSource = rawOptions.length ? rawOptions : fallbackOptions;
	const normalizedOptions = optionSource.map((option, optionIndex) =>
		normalizeOption(option, rawOptions.length ? (fallbackOptionById[option?.id] || {}) : {}, optionIndex)
	);

	normalizedOptions.sort((left, right) => {
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		return left.title.localeCompare(right.title, 'es');
	});

	const menu = {
		key,
		title: normalizeText(hasOwn(rawMenu, 'title') ? rawMenu.title : (fallbackMenu.title || key)),
		headerText: normalizeText(hasOwn(rawMenu, 'headerText') ? rawMenu.headerText : (fallbackMenu.headerText || '')),
		body: normalizeText(hasOwn(rawMenu, 'body') ? rawMenu.body : (fallbackMenu.body || '')),
		buttonText: normalizeText(hasOwn(rawMenu, 'buttonText') ? rawMenu.buttonText : (fallbackMenu.buttonText || 'Ver opciones')),
		footerText: normalizeText(hasOwn(rawMenu, 'footerText') ? rawMenu.footerText : (fallbackMenu.footerText || '')),
		sectionTitle: normalizeText(
			hasOwn(rawMenu, 'sectionTitle')
				? rawMenu.sectionTitle
				: (fallbackMenu.sectionTitle || rawMenu.title || fallbackMenu.title || 'Opciones')
		),
		fallbackTitle: normalizeText(hasOwn(rawMenu, 'fallbackTitle') ? rawMenu.fallbackTitle : (fallbackMenu.fallbackTitle || '')),
		textFallback: normalizeText(hasOwn(rawMenu, 'textFallback') ? rawMenu.textFallback : (fallbackMenu.textFallback || '')),
		isActive: rawMenu.isActive !== undefined ? Boolean(rawMenu.isActive) : (fallbackMenu.isActive !== undefined ? Boolean(fallbackMenu.isActive) : true),
		sortOrder: Number.isFinite(Number(rawMenu.sortOrder))
			? Number(rawMenu.sortOrder)
			: (Number.isFinite(Number(fallbackMenu.sortOrder)) ? Number(fallbackMenu.sortOrder) : index + 1),
		options: normalizedOptions
	};

	if (!menu.textFallback) {
		menu.textFallback = buildFallbackText(menu);
	}

	return menu;
}

export const GENERIC_WHATSAPP_MENU_CONFIG = {
	version: 1,
	autoMenuEnabled: true,
	mainMenuKey: DEFAULT_MAIN_MENU_KEY,
	menus: [
		{
			key: DEFAULT_MENU_PATHS.MAIN,
			title: 'Menu principal',
			headerText: 'Marca',
			body: 'Elegi una opcion para ayudarte mas rapido:',
			buttonText: 'Abrir menu',
			footerText: 'Escribi 0 o menu para volver al inicio.',
			sectionTitle: 'Menu principal',
			sortOrder: 1,
			options: [
				{
					id: 'menu_main_products',
					title: 'Ver catalogo',
					description: 'Productos y recomendaciones',
					aliases: ['1', 'productos', 'catalogo', 'ver productos', 'ver catalogo'],
					actionType: 'INTENT',
					actionValue: 'product',
					effectiveMessageBody: 'Quiero ver productos o recibir una recomendacion',
					summaryUserMessage: 'Cliente eligio menu: catalogo',
					sortOrder: 1
				},
				{
					id: 'menu_main_orders',
					title: 'Pedidos',
					description: 'Estado, problema o comprobante',
					aliases: ['2', 'pedido', 'pedidos', 'estado pedido', 'problema pedido'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.ORDERS,
					promptPrefix: 'Veamos tu pedido.',
					sortOrder: 2
				},
				{
					id: 'menu_main_support',
					title: 'Pagos y envios',
					description: 'Resolver dudas frecuentes',
					aliases: ['3', 'pagos', 'envios', 'envios', 'ayuda'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.SUPPORT,
					promptPrefix: 'Te dejo ayuda rapida.',
					sortOrder: 3
				},
				{
					id: 'menu_main_human',
					title: 'Hablar con una persona',
					description: 'Pasar a atencion humana',
					aliases: ['4', 'asesora', 'asesor', 'humano', 'persona'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 4
				}
			]
		},
		{
			key: DEFAULT_MENU_PATHS.ORDERS,
			title: 'Pedidos',
			headerText: 'Pedidos',
			body: 'Elegi que necesitas con tu pedido:',
			buttonText: 'Pedidos',
			footerText: 'Escribi 0 o menu para volver al inicio.',
			sectionTitle: 'Pedidos',
			sortOrder: 2,
			options: [
				{
					id: 'menu_orders_status',
					title: 'Estado de mi pedido',
					description: 'Consultar seguimiento o estado',
					aliases: ['1', 'estado', 'estado pedido', 'ver pedido', 'seguimiento'],
					actionType: 'INTENT',
					actionValue: 'order_status',
					effectiveMessageBody: 'Quiero saber el estado de mi pedido',
					summaryUserMessage: 'Cliente eligio menu: estado de pedido',
					sortOrder: 1
				},
				{
					id: 'menu_orders_issue',
					title: 'Problema con mi pedido',
					description: 'Contar lo que paso',
					aliases: ['2', 'problema', 'reclamo', 'pedido mal', 'problema pedido'],
					actionType: 'MESSAGE',
					replyBody: 'Contame que paso con tu pedido y, si lo tenes, pasame tambien el numero de pedido asi lo reviso mejor.',
					statePatch: {
						lastUserGoal: 'Resolver un problema con su pedido'
					},
					model: 'menu-order-issue',
					sortOrder: 2
				},
				{
					id: 'menu_orders_payment_proof',
					title: 'Enviar comprobante',
					description: 'Mandar foto o archivo',
					aliases: ['3', 'comprobante', 'pago', 'enviar comprobante'],
					actionType: 'MESSAGE',
					replyBody: 'Mandame el comprobante por aca en foto o archivo y lo revisamos.',
					statePatch: {
						lastUserGoal: 'Enviar comprobante de pago'
					},
					model: 'menu-payment-proof',
					sortOrder: 3
				},
				{
					id: 'menu_orders_back',
					title: 'Volver al inicio',
					description: 'Ir al menu principal',
					aliases: ['0', 'volver', 'inicio', 'menu'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.MAIN,
					promptPrefix: 'Volvimos al inicio.',
					sortOrder: 4
				}
			]
		},
		{
			key: DEFAULT_MENU_PATHS.SUPPORT,
			title: 'Ayuda rapida',
			headerText: 'Ayuda rapida',
			body: 'Elegi la consulta que queres resolver:',
			buttonText: 'Ayuda',
			footerText: 'Escribi 0 o menu para volver al inicio.',
			sectionTitle: 'Ayuda',
			sortOrder: 3,
			options: [
				{
					id: 'menu_support_payments',
					title: 'Medios de pago',
					description: 'Ver formas de pago disponibles',
					aliases: ['1', 'pago', 'pagos', 'medios de pago'],
					actionType: 'INTENT',
					actionValue: 'payment',
					effectiveMessageBody: 'Quiero saber que medios de pago aceptan',
					summaryUserMessage: 'Cliente eligio menu: medios de pago',
					sortOrder: 1
				},
				{
					id: 'menu_support_shipping',
					title: 'Envios',
					description: 'Consultar zonas y tiempos',
					aliases: ['2', 'envio', 'envios', 'shipping'],
					actionType: 'INTENT',
					actionValue: 'shipping',
					effectiveMessageBody: 'Quiero consultar sobre envios',
					summaryUserMessage: 'Cliente eligio menu: envios',
					sortOrder: 2
				},
				{
					id: 'menu_support_human',
					title: 'Hablar con una persona',
					description: 'Pasar a atencion humana',
					aliases: ['3', 'asesora', 'asesor', 'humano', 'atencion humana'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 3
				},
				{
					id: 'menu_support_back',
					title: 'Volver al inicio',
					description: 'Ir al menu principal',
					aliases: ['0', 'volver', 'inicio', 'menu'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.MAIN,
					promptPrefix: 'Volvimos al inicio.',
					sortOrder: 4
				}
			]
		}
	]
};

export const LUMMINE_WHATSAPP_MENU_CONFIG = {
	version: 1,
	autoMenuEnabled: true,
	mainMenuKey: DEFAULT_MAIN_MENU_KEY,
	menus: [
		{
			key: DEFAULT_MENU_PATHS.MAIN,
			title: 'Menú principal',
			headerText: 'Marca',
			body: 'Elegí una opción para ayudarte más rápido:',
			buttonText: 'Abrir menú',
			footerText: 'Escribí 0 o menú para volver al inicio.',
			sectionTitle: 'Menú principal',
			sortOrder: 1,
			options: [
				{
					id: 'menu_main_products',
					title: 'Ver productos',
					description: 'Bodys, calzas y catálogo',
					aliases: ['1', 'productos', 'ver productos', 'product', 'producto'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.PRODUCTS,
					promptPrefix: 'Perfecto. Vamos por productos.',
					sortOrder: 1
				},
				{
					id: 'menu_main_orders',
					title: 'Pedidos',
					description: 'Estado, problema o comprobante',
					aliases: ['2', 'pedido', 'pedidos', 'estado pedido', 'problema pedido'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.ORDERS,
					promptPrefix: 'Dale. Veamos tu pedido.',
					sortOrder: 2
				},
				{
					id: 'menu_main_support',
					title: 'Pagos, envíos y talles',
					description: 'Resolver dudas rápidas',
					aliases: ['3', 'pagos', 'envios', 'envíos', 'talles', 'ayuda'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.SUPPORT,
					promptPrefix: 'Buenísimo. Te dejo ayuda rápida.',
					sortOrder: 3
				},
				{
					id: 'menu_main_human',
					title: 'Hablar con una asesora',
					description: 'Pasar a atención humana',
					aliases: ['4', 'asesora', 'asesor', 'humano', 'persona'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 4
				}
			]
		},
		{
			key: DEFAULT_MENU_PATHS.PRODUCTS,
			title: 'Productos',
			headerText: 'Productos',
			body: 'Elegí qué querés ver:',
			buttonText: 'Productos',
			footerText: 'Escribí 0 o menú para volver al inicio.',
			sectionTitle: 'Productos',
			sortOrder: 2,
			options: [
				{
					id: 'menu_products_bodys',
					title: 'Bodys modeladores',
					description: 'Ver opciones y promos',
					aliases: ['1', 'body', 'bodys', 'body modelador', 'bodys modeladores', 'ver bodys'],
					actionType: 'INTENT',
					actionValue: 'product',
					effectiveMessageBody: 'Quiero ver bodys modeladores y sus promos disponibles',
					summaryUserMessage: 'Cliente eligió menú: bodys modeladores',
					statePatch: {
						currentProductFocus: 'bodys modeladores',
						currentProductFamily: 'body_modelador',
						interestedProducts: ['bodys modeladores'],
						categoryLocked: true,
						salesStage: 'DISCOVERY'
					},
					sortOrder: 1
				},
				{
					id: 'menu_products_calzas',
					title: 'Calzas linfáticas',
					description: 'Consultar modelos disponibles',
					aliases: ['2', 'calza', 'calzas', 'calzas linfaticas', 'calzas linfáticas'],
					actionType: 'INTENT',
					actionValue: 'product',
					effectiveMessageBody: 'Quiero ver calzas linfáticas y sus promos disponibles',
					summaryUserMessage: 'Cliente eligió menú: calzas linfáticas',
					statePatch: {
						currentProductFocus: 'calzas linfáticas',
						currentProductFamily: 'calzas_linfaticas',
						interestedProducts: ['calzas linfáticas'],
						categoryLocked: true,
						salesStage: 'DISCOVERY'
					},
					sortOrder: 2
				},
				{
					id: 'menu_products_catalog',
					title: 'Catálogo general',
					description: 'Pedir catálogo o recomendación',
					aliases: ['3', 'catalogo', 'catálogo', 'catalogo general', 'ver catalogo', 'ver catálogo'],
					actionType: 'INTENT',
					actionValue: 'product',
					effectiveMessageBody: 'Quiero ver el catálogo general y recibir una recomendación',
					summaryUserMessage: 'Cliente eligió menú: catálogo general',
					sortOrder: 3
				},
				{
					id: 'menu_products_back',
					title: 'Volver al inicio',
					description: 'Ir al menú principal',
					aliases: ['0', 'volver', 'inicio', 'menu', 'menú'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.MAIN,
					promptPrefix: 'Volvimos al inicio.',
					sortOrder: 4
				}
			]
		},
		{
			key: DEFAULT_MENU_PATHS.ORDERS,
			title: 'Pedidos',
			headerText: 'Pedidos',
			body: 'Elegí qué necesitás con tu pedido:',
			buttonText: 'Pedidos',
			footerText: 'Escribí 0 o menú para volver al inicio.',
			sectionTitle: 'Pedidos',
			sortOrder: 3,
			options: [
				{
					id: 'menu_orders_status',
					title: 'Estado de mi pedido',
					description: 'Consultar seguimiento o estado',
					aliases: ['1', 'estado', 'estado pedido', 'ver pedido', 'seguimiento'],
					actionType: 'INTENT',
					actionValue: 'order_status',
					effectiveMessageBody: 'Quiero saber el estado de mi pedido',
					summaryUserMessage: 'Cliente eligió menú: estado de pedido',
					sortOrder: 1
				},
				{
					id: 'menu_orders_issue',
					title: 'Problema con mi pedido',
					description: 'Contar lo que pasó',
					aliases: ['2', 'problema', 'reclamo', 'pedido mal', 'problema pedido'],
					actionType: 'MESSAGE',
					replyBody: 'Contame qué pasó con tu pedido y, si lo tenés, pasame también el número de pedido así lo reviso mejor.',
					statePatch: {
						lastUserGoal: 'Resolver un problema con su pedido'
					},
					model: 'menu-order-issue',
					sortOrder: 2
				},
				{
					id: 'menu_orders_payment_proof',
					title: 'Enviar comprobante',
					description: 'Mandar foto o archivo',
					aliases: ['3', 'comprobante', 'pago', 'enviar comprobante'],
					actionType: 'MESSAGE',
					replyBody: 'Mandame el comprobante por acá en foto o archivo y lo revisamos.',
					statePatch: {
						lastUserGoal: 'Enviar comprobante de pago'
					},
					model: 'menu-payment-proof',
					sortOrder: 3
				},
				{
					id: 'menu_orders_back',
					title: 'Volver al inicio',
					description: 'Ir al menú principal',
					aliases: ['0', 'volver', 'inicio', 'menu', 'menú'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.MAIN,
					promptPrefix: 'Volvimos al inicio.',
					sortOrder: 4
				}
			]
		},
		{
			key: DEFAULT_MENU_PATHS.SUPPORT,
			title: 'Ayuda rápida',
			headerText: 'Ayuda rápida',
			body: 'Elegí la consulta que querés resolver:',
			buttonText: 'Ayuda',
			footerText: 'Escribí 0 o menú para volver al inicio.',
			sectionTitle: 'Ayuda',
			sortOrder: 4,
			options: [
				{
					id: 'menu_support_payments',
					title: 'Medios de pago',
					description: 'Ver formas de pago disponibles',
					aliases: ['1', 'pago', 'pagos', 'medios de pago'],
					actionType: 'INTENT',
					actionValue: 'payment',
					effectiveMessageBody: 'Quiero saber qué medios de pago aceptan',
					summaryUserMessage: 'Cliente eligió menú: medios de pago',
					sortOrder: 1
				},
				{
					id: 'menu_support_shipping',
					title: 'Envíos',
					description: 'Consultar zonas y tiempos',
					aliases: ['2', 'envio', 'envíos', 'shipping'],
					actionType: 'INTENT',
					actionValue: 'shipping',
					effectiveMessageBody: 'Quiero consultar sobre envíos',
					summaryUserMessage: 'Cliente eligió menú: envíos',
					sortOrder: 2
				},
				{
					id: 'menu_support_sizes',
					title: 'Talles',
					description: 'Pedir ayuda con el talle',
					aliases: ['3', 'talle', 'talles', 'size', 'sizes'],
					actionType: 'INTENT',
					actionValue: 'size_help',
					effectiveMessageBody: 'Necesito ayuda con los talles',
					summaryUserMessage: 'Cliente eligió menú: talles',
					sortOrder: 3
				},
				{
					id: 'menu_support_human',
					title: 'Hablar con una asesora',
					description: 'Pasar a atención humana',
					aliases: ['4', 'asesora', 'asesor', 'humano', 'atencion humana', 'atención humana'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 4
				},
				{
					id: 'menu_support_back',
					title: 'Volver al inicio',
					description: 'Ir al menú principal',
					aliases: ['0', 'volver', 'inicio', 'menu', 'menú'],
					actionType: 'SUBMENU',
					actionValue: DEFAULT_MENU_PATHS.MAIN,
					promptPrefix: 'Volvimos al inicio.',
					sortOrder: 5
				}
			]
		}
	]
};

export const DEFAULT_WHATSAPP_MENU_CONFIG = GENERIC_WHATSAPP_MENU_CONFIG;

export const INSURANCE_WHATSAPP_MENU_CONFIG = {
	version: 1,
	autoMenuEnabled: true,
	mainMenuKey: DEFAULT_MAIN_MENU_KEY,
	menus: [
		{
			key: DEFAULT_MENU_PATHS.MAIN,
			title: 'Menu principal',
			headerText: 'Seguros',
			body: 'Elige una opcion para ayudarte:',
			buttonText: 'Abrir menu',
			footerText: 'Escribe 0 o menu para volver al inicio.',
			sectionTitle: 'Menu principal',
			sortOrder: 1,
			options: [
				{
					id: 'menu_insurance_services',
					title: 'Seguros',
					description: 'Salud, empresa, dental y mas',
					aliases: ['1', 'seguros', 'polizas', 'servicios'],
					actionType: 'INTENT',
					actionValue: 'product',
					effectiveMessageBody: 'Quiero orientacion sobre seguros disponibles',
					summaryUserMessage: 'Cliente eligio menu: seguros',
					sortOrder: 1
				},
				{
					id: 'menu_insurance_office',
					title: 'Citas y oficina',
					description: 'Direccion, horario y contacto',
					aliases: ['2', 'cita', 'oficina', 'direccion', 'horario'],
					actionType: 'MESSAGE',
					replyBody: 'La oficina esta en C. Silva, 5, 35110 Vecindario, Las Palmas. Horario: lunes a viernes de 09:00 a 14:00. Tardes con cita previa.',
					model: 'menu-insurance-office',
					sortOrder: 2
				},
				{
					id: 'menu_insurance_customer',
					title: 'Gestion de cliente',
					description: 'Poliza, autorizacion o reembolso',
					aliases: ['3', 'cliente', 'poliza', 'autorizacion', 'reembolso'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 3
				},
				{
					id: 'menu_insurance_human',
					title: 'Hablar con asesor',
					description: 'Pasar a atencion humana',
					aliases: ['4', 'asesor', 'humano', 'persona'],
					actionType: 'HUMAN',
					actionValue: 'human',
					sortOrder: 4
				}
			]
		}
	]
};

export function normalizeWhatsAppMenuConfig(inputConfig = {}) {
	const defaultConfig = clone(DEFAULT_WHATSAPP_MENU_CONFIG);
	const sourceConfig = typeof inputConfig === 'object' && inputConfig !== null ? inputConfig : {};
	const sourceMenus = asArray(sourceConfig.menus);
	const fallbackMenus = asArray(defaultConfig.menus);
	const mergedConfig = {
		version: Number.isFinite(Number(sourceConfig.version)) ? Number(sourceConfig.version) : defaultConfig.version,
		autoMenuEnabled: hasOwn(sourceConfig, 'autoMenuEnabled')
			? Boolean(sourceConfig.autoMenuEnabled)
			: Boolean(defaultConfig.autoMenuEnabled),
		mainMenuKey: normalizeText(sourceConfig.mainMenuKey || defaultConfig.mainMenuKey) || DEFAULT_MAIN_MENU_KEY,
		menus: []
	};
	const fallbackByKey = Object.fromEntries(fallbackMenus.map((menu) => [menu.key, menu]));
	const menuSource = sourceMenus.length ? sourceMenus : fallbackMenus;

	for (const [index, rawMenu] of menuSource.entries()) {
		const fallbackMenu = sourceMenus.length ? (fallbackByKey[rawMenu?.key] || {}) : {};
		mergedConfig.menus.push(normalizeMenu(rawMenu, fallbackMenu, index));
	}

	mergedConfig.menus.sort((left, right) => {
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		return left.title.localeCompare(right.title, 'es');
	});

	if (!mergedConfig.menus.some((menu) => menu.key === mergedConfig.mainMenuKey && menu.isActive)) {
		mergedConfig.mainMenuKey = mergedConfig.menus.find((menu) => menu.isActive)?.key || DEFAULT_MAIN_MENU_KEY;
	}

	return mergedConfig;
}

function buildRuntimeMenu(menu) {
	const activeOptions = asArray(menu.options).filter((option) => option?.isActive);
	const sections = activeOptions.length
		? [
			{
				title: normalizeText(menu.sectionTitle || menu.title || 'Opciones'),
				rows: activeOptions.map((option) => ({
					id: option.id,
					title: option.title,
					description: option.description || undefined
				}))
			}
		]
		: [];

	const optionById = Object.fromEntries(activeOptions.map((option) => [option.id, option]));

	return {
		...menu,
		path: menu.key,
		sections,
		optionById,
		textFallback: menu.textFallback || buildFallbackText(menu)
	};
}

function buildRuntimePayload(settings) {
	const normalizedConfig = normalizeWhatsAppMenuConfig(settings?.config || DEFAULT_WHATSAPP_MENU_CONFIG);
	const runtimeMenus = normalizedConfig.menus
		.filter((menu) => menu?.isActive)
		.map((menu) => buildRuntimeMenu(menu));
	const menusByKey = Object.fromEntries(runtimeMenus.map((menu) => [menu.key, menu]));
	const mainMenuKey = menusByKey[normalizedConfig.mainMenuKey]
		? normalizedConfig.mainMenuKey
		: (runtimeMenus[0]?.key || DEFAULT_MAIN_MENU_KEY);

	return {
		settingsId: settings?.id || null,
		settingsName: settings?.name || 'Configuración principal',
		mainMenuKey,
		config: normalizedConfig,
		menusByKey
	};
}

async function getDefaultMenuConfigForWorkspace(workspaceId = DEFAULT_WORKSPACE_ID) {
	try {
		const workspaceConfig = await getWorkspaceRuntimeConfig(workspaceId);
		const aiProfile = resolveAiProfile({ workspaceConfig, workspaceId });
		if (aiProfile === AI_PROFILES.DKV_INSURANCE) return INSURANCE_WHATSAPP_MENU_CONFIG;
		if (aiProfile === AI_PROFILES.LUMMINE_BODYWEAR) return LUMMINE_WHATSAPP_MENU_CONFIG;
		return DEFAULT_WHATSAPP_MENU_CONFIG;
	} catch {
		return DEFAULT_WHATSAPP_MENU_CONFIG;
	}
}

export async function getOrCreateWhatsAppMenuSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const defaultConfig = await getDefaultMenuConfigForWorkspace(resolvedWorkspaceId);
	let settings = await prisma.whatsAppMenuSetting.findUnique({
		where: {
			workspaceId_key: {
				workspaceId: resolvedWorkspaceId,
				key: SETTINGS_KEY
			}
		}
	});

	if (!settings) {
		settings = await prisma.whatsAppMenuSetting.create({
			data: {
				workspaceId: resolvedWorkspaceId,
				key: SETTINGS_KEY,
				name: 'Configuración principal',
				isActive: true,
				config: defaultConfig
			}
		});
	}

	return settings;
}

export async function getWhatsAppMenuSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const settings = await getOrCreateWhatsAppMenuSettings({ workspaceId });
	return {
		...settings,
		config: normalizeWhatsAppMenuConfig(settings.config)
	};
}

export async function updateWhatsAppMenuSettings({ workspaceId = DEFAULT_WORKSPACE_ID, config, name }) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const normalizedConfig = normalizeWhatsAppMenuConfig(config || {});
	const normalizedName = normalizeText(name || 'Configuración principal') || 'Configuración principal';

	const settings = await prisma.whatsAppMenuSetting.upsert({
		where: {
			workspaceId_key: {
				workspaceId: resolvedWorkspaceId,
				key: SETTINGS_KEY
			}
		},
		update: {
			name: normalizedName,
			isActive: true,
			config: normalizedConfig
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			key: SETTINGS_KEY,
			name: normalizedName,
			isActive: true,
			config: normalizedConfig
		}
	});

	runtimeCacheByWorkspace.delete(resolvedWorkspaceId);

	return {
		...settings,
		config: normalizedConfig
	};
}

export async function resetWhatsAppMenuSettings({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const defaultConfig = await getDefaultMenuConfigForWorkspace(resolvedWorkspaceId);
	const settings = await prisma.whatsAppMenuSetting.upsert({
		where: {
			workspaceId_key: {
				workspaceId: resolvedWorkspaceId,
				key: SETTINGS_KEY
			}
		},
		update: {
			name: 'Configuración principal',
			isActive: true,
			config: defaultConfig
		},
		create: {
			workspaceId: resolvedWorkspaceId,
			key: SETTINGS_KEY,
			name: 'Configuración principal',
			isActive: true,
			config: defaultConfig
		}
	});

	runtimeCacheByWorkspace.delete(resolvedWorkspaceId);

	return {
		...settings,
		config: normalizeWhatsAppMenuConfig(settings.config)
	};
}

export async function getWhatsAppMenuRuntimeConfig({ workspaceId = DEFAULT_WORKSPACE_ID, forceRefresh = false } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const runtimeCache = runtimeCacheByWorkspace.get(resolvedWorkspaceId);
	if (!forceRefresh && runtimeCache?.value && runtimeCache.expiresAt > Date.now()) {
		return runtimeCache.value;
	}

	try {
		const settings = await getOrCreateWhatsAppMenuSettings({ workspaceId: resolvedWorkspaceId });
		const runtimePayload = buildRuntimePayload(settings);
		runtimeCacheByWorkspace.set(resolvedWorkspaceId, {
			expiresAt: Date.now() + CACHE_TTL_MS,
			value: runtimePayload
		});
		return runtimePayload;
	} catch (error) {
		logger.warn('whatsapp_menu.runtime_config_failed', { workspaceId: resolvedWorkspaceId, error });
		const runtimePayload = buildRuntimePayload({
			id: null,
			name: 'Fallback local',
			config: DEFAULT_WHATSAPP_MENU_CONFIG
		});
		runtimeCacheByWorkspace.set(resolvedWorkspaceId, {
			expiresAt: Date.now() + CACHE_TTL_MS,
			value: runtimePayload
		});
		return runtimePayload;
	}
}

function formatMenuOptionLabel(option = {}) {
	return normalizeText(option.title || option.description || '').trim();
}

function buildSoftMenuSuffix(options = []) {
	const labels = asArray(options)
		.map(formatMenuOptionLabel)
		.filter(Boolean)
		.slice(0, 4);

	if (!labels.length) {
		return '';
	}

	if (labels.length === 1) {
		return `Si querés, también puedo ayudarte con ${labels[0].toLowerCase()}.`;
	}

	const head = labels.slice(0, -1).map((item) => item.toLowerCase());
	const tail = labels[labels.length - 1].toLowerCase();

	return `Si querés, también puedo ayudarte con ${head.join(', ')} o ${tail}.`;
}

function resolveRelevantMenuKeys(intent = '', currentState = {}) {
	const normalizedIntent = normalizeLooseText(intent);
	const lastIntent = normalizeLooseText(currentState?.lastIntent || '');
	const activeMenuPath = normalizeText(currentState?.menuPath || '');

	if (activeMenuPath) {
		return [activeMenuPath, DEFAULT_MENU_PATHS.MAIN, DEFAULT_MENU_PATHS.PRODUCTS, DEFAULT_MENU_PATHS.SUPPORT];
	}

	if (normalizedIntent === 'order_status' || lastIntent === 'order_status') {
		return [DEFAULT_MENU_PATHS.ORDERS, DEFAULT_MENU_PATHS.SUPPORT, DEFAULT_MENU_PATHS.MAIN];
	}

	if (['payment', 'shipping', 'size_help'].includes(normalizedIntent)) {
		return [DEFAULT_MENU_PATHS.SUPPORT, DEFAULT_MENU_PATHS.PRODUCTS, DEFAULT_MENU_PATHS.MAIN];
	}

	if (normalizedIntent === 'product' || asArray(currentState?.interestedProducts).length) {
		return [DEFAULT_MENU_PATHS.PRODUCTS, DEFAULT_MENU_PATHS.SUPPORT, DEFAULT_MENU_PATHS.MAIN];
	}

	return [DEFAULT_MENU_PATHS.MAIN, DEFAULT_MENU_PATHS.PRODUCTS, DEFAULT_MENU_PATHS.SUPPORT];
}

export async function buildMenuAssistantContext({
	workspaceId = DEFAULT_WORKSPACE_ID,
	intent = '',
	currentState = {},
	responsePolicy = {},
	commercialPlan = null,
	queueDecision = null,
} = {}) {
	const runtime = await getWhatsAppMenuRuntimeConfig({ workspaceId });
	let verticalProfile = null;
	let useCommerce = true;
	try {
		const workspaceConfig = await getWorkspaceRuntimeConfig(workspaceId);
		const aiProfile = resolveAiProfile({ workspaceConfig, workspaceId });
		verticalProfile = getAiVerticalProfile(aiProfile);
		useCommerce = usesCommerceEngine(aiProfile);
	} catch {
		verticalProfile = null;
		useCommerce = true;
	}
	const relevantKeys = resolveRelevantMenuKeys(intent, currentState);
	const collectedOptions = [];

	for (const key of relevantKeys) {
		const menu = runtime?.menusByKey?.[key];
		if (!menu?.options?.length) continue;

		for (const option of menu.options) {
			if (!option?.isActive) continue;
			if (option.actionType === 'SUBMENU') continue;
			if (collectedOptions.some((item) => item.id === option.id)) continue;

			collectedOptions.push({
				id: option.id,
				title: option.title,
				description: option.description || '',
				actionType: option.actionType,
			});

			if (collectedOptions.length >= 4) break;
		}

		if (collectedOptions.length >= 4) break;
	}

	if (!useCommerce) {
		const bannedOptionPattern = /(producto|catalogo|cat[aá]logo|pago|envio|envío|talle|stock|carrito|promo)/i;
		for (let index = collectedOptions.length - 1; index >= 0; index -= 1) {
			const option = collectedOptions[index];
			if (bannedOptionPattern.test(`${option.title} ${option.description}`)) {
				collectedOptions.splice(index, 1);
			}
		}
		for (const [index, title] of (verticalProfile?.genericMenuOptions || []).entries()) {
			if (collectedOptions.length >= 4) break;
			if (collectedOptions.some((option) => option.title === title)) continue;
			collectedOptions.push({
				id: `vertical_${index + 1}`,
				title,
				description: '',
				actionType: title.toLowerCase().includes('asesor') ? 'HUMAN' : 'MESSAGE',
			});
		}
	}

	const allowSoftMenu =
		queueDecision?.queue !== 'HUMAN' &&
		currentState?.needsHuman !== true;
	const canSurfaceInline =
		allowSoftMenu &&
		(
			commercialPlan?.greetingOnly ||
			responsePolicy?.action === 'general_help' ||
			responsePolicy?.action === 'ask_order_number_or_not_found' ||
			responsePolicy?.action === 'greet_and_discover'
		);

	const promptBlock = collectedOptions.length
		? [
			'TENÉS UN MENÚ DE AYUDA DISPONIBLE, PERO NO LO IMPONGAS.',
			'Usalo solo como apoyo natural si suma claridad o si la clienta está abierta, ambigua o pide opciones.',
			`Opciones disponibles: ${collectedOptions.map((option) => option.title).join(' | ')}.`,
			'No mandes el menú completo salvo que la clienta lo pida o esté desorientada.',
			'No pegues una coletilla fija de menú al final de respuestas concretas.',
			canSurfaceInline
				? 'Si querés orientar, hacelo en una sola línea corta y natural, ofreciendo hasta 3 caminos.'
				: 'Si ya estás resolviendo algo concreto, seguí directo sin mencionar el menú.'
		].join('\n')
		: '';

	return {
		options: collectedOptions,
		shouldAppendToReply: false,
		suffixText: canSurfaceInline ? buildSoftMenuSuffix(collectedOptions) : '',
		surfaceMode: canSurfaceInline ? 'inline_if_helpful' : 'prompt_only',
		promptBlock,
	};
}
