import { prisma } from '../../lib/prisma.js';

export const DEFAULT_MENU_PATHS = {
	MAIN: 'MAIN_MENU',
	PRODUCTS: 'PRODUCTS_MENU',
	ORDERS: 'ORDERS_MENU',
	SUPPORT: 'SUPPORT_MENU'
};

export const DEFAULT_MAIN_MENU_KEY = DEFAULT_MENU_PATHS.MAIN;
const SETTINGS_KEY = 'default';
const CACHE_TTL_MS = 15000;

let runtimeCache = {
	expiresAt: 0,
	value: null
};

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
	const aliases = [
		...asArray(fallbackOption.aliases),
		...asArray(rawOption.aliases)
	]
		.map((value) => normalizeText(value))
		.filter(Boolean);

	const option = {
		id,
		title: normalizeText(rawOption.title || fallbackOption.title || `Opción ${index + 1}`),
		description: normalizeText(rawOption.description || fallbackOption.description || ''),
		aliases: [...new Set(aliases)],
		actionType: normalizeText(rawOption.actionType || fallbackOption.actionType || 'MESSAGE').toUpperCase(),
		actionValue: normalizeText(rawOption.actionValue || fallbackOption.actionValue || ''),
		promptPrefix: normalizeText(rawOption.promptPrefix || fallbackOption.promptPrefix || ''),
		replyBody: normalizeText(rawOption.replyBody || fallbackOption.replyBody || ''),
		effectiveMessageBody: normalizeText(rawOption.effectiveMessageBody || fallbackOption.effectiveMessageBody || ''),
		summaryUserMessage: normalizeText(rawOption.summaryUserMessage || fallbackOption.summaryUserMessage || ''),
		handoffReason: normalizeText(rawOption.handoffReason || fallbackOption.handoffReason || ''),
		model: normalizeText(rawOption.model || fallbackOption.model || ''),
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
	const seenIds = new Set();

	const normalizedOptions = rawOptions
		.map((option, optionIndex) => {
			const normalized = normalizeOption(option, fallbackOptionById[option?.id] || {}, optionIndex);
			seenIds.add(normalized.id);
			return normalized;
		});

	for (const [optionIndex, fallbackOption] of fallbackOptions.entries()) {
		if (seenIds.has(fallbackOption.id)) continue;
		normalizedOptions.push(normalizeOption({}, fallbackOption, optionIndex + normalizedOptions.length));
	}

	normalizedOptions.sort((left, right) => {
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		return left.title.localeCompare(right.title, 'es');
	});

	const menu = {
		key,
		title: normalizeText(rawMenu.title || fallbackMenu.title || key),
		headerText: normalizeText(rawMenu.headerText || fallbackMenu.headerText || ''),
		body: normalizeText(rawMenu.body || fallbackMenu.body || ''),
		buttonText: normalizeText(rawMenu.buttonText || fallbackMenu.buttonText || 'Ver opciones'),
		footerText: normalizeText(rawMenu.footerText || fallbackMenu.footerText || ''),
		sectionTitle: normalizeText(rawMenu.sectionTitle || fallbackMenu.sectionTitle || rawMenu.title || fallbackMenu.title || 'Opciones'),
		fallbackTitle: normalizeText(rawMenu.fallbackTitle || fallbackMenu.fallbackTitle || ''),
		textFallback: normalizeText(rawMenu.textFallback || fallbackMenu.textFallback || ''),
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

export const DEFAULT_WHATSAPP_MENU_CONFIG = {
	version: 1,
	mainMenuKey: DEFAULT_MAIN_MENU_KEY,
	menus: [
		{
			key: DEFAULT_MENU_PATHS.MAIN,
			title: 'Menú principal',
			headerText: 'Lummine',
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
					effectiveMessageBody: 'Quiero ver bodys modeladores',
					summaryUserMessage: 'Cliente eligió menú: bodys modeladores',
					statePatch: {
						currentProductFocus: 'bodys modeladores',
						interestedProducts: ['bodys modeladores']
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
					effectiveMessageBody: 'Quiero ver calzas linfáticas',
					summaryUserMessage: 'Cliente eligió menú: calzas linfáticas',
					statePatch: {
						currentProductFocus: 'calzas linfáticas',
						interestedProducts: ['calzas linfáticas']
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

export function normalizeWhatsAppMenuConfig(inputConfig = {}) {
	const defaultConfig = clone(DEFAULT_WHATSAPP_MENU_CONFIG);
	const sourceConfig = typeof inputConfig === 'object' && inputConfig !== null ? inputConfig : {};
	const mergedConfig = {
		version: Number.isFinite(Number(sourceConfig.version)) ? Number(sourceConfig.version) : defaultConfig.version,
		mainMenuKey: normalizeText(sourceConfig.mainMenuKey || defaultConfig.mainMenuKey) || DEFAULT_MAIN_MENU_KEY,
		menus: []
	};

	const fallbackMenus = asArray(defaultConfig.menus);
	const fallbackByKey = Object.fromEntries(fallbackMenus.map((menu) => [menu.key, menu]));
	const sourceMenus = asArray(sourceConfig.menus);
	const seenKeys = new Set();

	for (const [index, rawMenu] of sourceMenus.entries()) {
		const normalized = normalizeMenu(rawMenu, fallbackByKey[rawMenu?.key] || {}, index);
		seenKeys.add(normalized.key);
		mergedConfig.menus.push(normalized);
	}

	for (const [index, fallbackMenu] of fallbackMenus.entries()) {
		if (seenKeys.has(fallbackMenu.key)) continue;
		mergedConfig.menus.push(normalizeMenu({}, fallbackMenu, sourceMenus.length + index));
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

export async function getOrCreateWhatsAppMenuSettings() {
	let settings = await prisma.whatsAppMenuSetting.findUnique({
		where: { key: SETTINGS_KEY }
	});

	if (!settings) {
		settings = await prisma.whatsAppMenuSetting.create({
			data: {
				key: SETTINGS_KEY,
				name: 'Configuración principal',
				isActive: true,
				config: DEFAULT_WHATSAPP_MENU_CONFIG
			}
		});
	}

	return settings;
}

export async function getWhatsAppMenuSettings() {
	const settings = await getOrCreateWhatsAppMenuSettings();
	return {
		...settings,
		config: normalizeWhatsAppMenuConfig(settings.config)
	};
}

export async function updateWhatsAppMenuSettings({ config, name }) {
	const normalizedConfig = normalizeWhatsAppMenuConfig(config || {});
	const normalizedName = normalizeText(name || 'Configuración principal') || 'Configuración principal';

	const settings = await prisma.whatsAppMenuSetting.upsert({
		where: { key: SETTINGS_KEY },
		update: {
			name: normalizedName,
			isActive: true,
			config: normalizedConfig
		},
		create: {
			key: SETTINGS_KEY,
			name: normalizedName,
			isActive: true,
			config: normalizedConfig
		}
	});

	runtimeCache = { expiresAt: 0, value: null };

	return {
		...settings,
		config: normalizedConfig
	};
}

export async function resetWhatsAppMenuSettings() {
	const settings = await prisma.whatsAppMenuSetting.upsert({
		where: { key: SETTINGS_KEY },
		update: {
			name: 'Configuración principal',
			isActive: true,
			config: DEFAULT_WHATSAPP_MENU_CONFIG
		},
		create: {
			key: SETTINGS_KEY,
			name: 'Configuración principal',
			isActive: true,
			config: DEFAULT_WHATSAPP_MENU_CONFIG
		}
	});

	runtimeCache = { expiresAt: 0, value: null };

	return {
		...settings,
		config: normalizeWhatsAppMenuConfig(settings.config)
	};
}

export async function getWhatsAppMenuRuntimeConfig({ forceRefresh = false } = {}) {
	if (!forceRefresh && runtimeCache.value && runtimeCache.expiresAt > Date.now()) {
		return runtimeCache.value;
	}

	try {
		const settings = await getOrCreateWhatsAppMenuSettings();
		const runtimePayload = buildRuntimePayload(settings);
		runtimeCache = {
			expiresAt: Date.now() + CACHE_TTL_MS,
			value: runtimePayload
		};
		return runtimePayload;
	} catch (error) {
		console.error('[WHATSAPP MENU] No se pudo cargar la configuración desde la base. Se usa fallback.', error);
		const runtimePayload = buildRuntimePayload({
			id: null,
			name: 'Fallback local',
			config: DEFAULT_WHATSAPP_MENU_CONFIG
		});
		runtimeCache = {
			expiresAt: Date.now() + CACHE_TTL_MS,
			value: runtimePayload
		};
		return runtimePayload;
	}
}
