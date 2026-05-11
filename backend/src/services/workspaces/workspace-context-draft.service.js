import { prisma } from '../../lib/prisma.js';
import { fetchWithTimeout, getHttpTimeoutMs } from '../../lib/http-timeout.js';
import { runGeminiReply, isRetryableGeminiError } from '../ai/gemini.service.js';
import { runOpenAIReply } from '../ai/openai.service.js';

function normalizeText(value = '') {
	return String(value || '')
		.trim()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

function normalizeSpacing(value = '') {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value = '') {
	return String(value || '')
		.split(/\r?\n/)
		.map((line) => normalizeSpacing(line))
		.filter(Boolean)
		.join('\n');
}

function decodeHtmlEntities(value = '') {
	return String(value || '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>');
}

function uniqueStrings(values = []) {
	return [...new Set(values.map((item) => normalizeSpacing(item)).filter(Boolean))];
}

function splitTags(value = '') {
	return String(value || '')
		.split(',')
		.map((item) => normalizeSpacing(item))
		.filter(Boolean);
}

function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

function addCount(map, value, amount = 1) {
	const key = normalizeSpacing(value);
	if (!key) return;
	map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, limit = 5) {
	return [...map.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit)
		.map(([label, count]) => ({ label, count }));
}

function formatCurrency(value) {
	const amount = Number(value || 0);
	if (!Number.isFinite(amount)) return null;
	try {
		return new Intl.NumberFormat('es-AR', {
			style: 'currency',
			currency: 'ARS',
			maximumFractionDigits: 0
		}).format(amount);
	} catch {
		return `$${Math.round(amount)}`;
	}
}

function normalizeUrl(value = '') {
	const raw = String(value || '').trim();
	if (!raw) return '';
	if (/^https?:\/\//i.test(raw)) return raw;
	return `https://${raw.replace(/^\/+/, '')}`;
}

function stripHtml(html = '') {
	return decodeHtmlEntities(
		String(html || '')
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
			.replace(/<[^>]+>/g, ' ')
	);
}

function extractFirstMatch(html = '', pattern) {
	const match = String(html || '').match(pattern);
	return normalizeSpacing(stripHtml(match?.[1] || ''));
}

function extractAllMatches(html = '', pattern, limit = 6) {
	const matches = [];
	const source = String(html || '');
	for (const match of source.matchAll(pattern)) {
		const value = normalizeSpacing(stripHtml(match?.[1] || ''));
		if (!value) continue;
		matches.push(value);
		if (matches.length >= limit) break;
	}
	return uniqueStrings(matches);
}

async function fetchWebsiteSignals(url = '') {
	const normalizedUrl = normalizeUrl(url);
	if (!normalizedUrl) return null;

	const timeoutMs = getHttpTimeoutMs('WEBSITE_ANALYSIS_TIMEOUT_MS', 12000);
	const response = await fetchWithTimeout(
		normalizedUrl,
		{
			method: 'GET',
			headers: {
				'User-Agent': 'BotLummine Context Analyzer',
				'Accept': 'text/html,application/xhtml+xml'
			},
			redirect: 'follow'
		},
		timeoutMs
	);

	if (!response.ok) {
		throw new Error(`No se pudo leer la web (${response.status}).`);
	}

	const html = String(await response.text() || '').slice(0, 250000);
	const title = extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
	const metaDescription =
		extractFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ||
		extractFirstMatch(html, /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
	const h1 = extractAllMatches(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi, 3);
	const h2 = extractAllMatches(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi, 6);
	const paragraphs = extractAllMatches(html, /<p[^>]*>([\s\S]*?)<\/p>/gi, 8)
		.filter((item) => item.length >= 40)
		.slice(0, 5);
	const visibleText = normalizeSpacing(stripHtml(html)).slice(0, 1800);

	return {
		url: normalizedUrl,
		title,
		metaDescription,
		h1,
		h2,
		paragraphs,
		visibleText
	};
}

function collectCategoryLabels(rawCategories = []) {
	const categories = safeArray(rawCategories);
	const labels = [];

	for (const item of categories) {
		if (!item) continue;
		if (typeof item === 'string') {
			labels.push(item);
			continue;
		}

		if (typeof item === 'object') {
			labels.push(
				item.name ||
				item.label ||
				item.title ||
				item.full_name ||
				item.path ||
				''
			);
		}
	}

	return uniqueStrings(labels);
}

function collectAttributeLabels(rawAttributes = []) {
	const attributes = safeArray(rawAttributes);
	const labels = [];

	for (const item of attributes) {
		if (!item || typeof item !== 'object') continue;
		labels.push(item.name || item.label || '');
		labels.push(item.value || item.values?.join?.(', ') || '');
	}

	return uniqueStrings(labels);
}

function extractVariantMeta(variants = []) {
	const colors = new Set();
	const sizes = new Set();
	const hints = new Set();
	const colorKeywords = [
		'negro', 'blanco', 'beige', 'gris', 'azul', 'celeste', 'verde', 'bordo',
		'rosa', 'rojo', 'marron', 'marron', 'camel', 'arena', 'crudo', 'natural',
		'dorado', 'plateado', 'violeta', 'lila', 'fucsia', 'nude', 'chocolate'
	];
	const sizeRegex = /\b(xs|s|m|l|xl|xxl|xxxl|4xl|5xl|6xl|s\/m|m\/l|l\/xl|xl\/2xl|xl\/xxl|2xl\/3xl|3xl\/4xl|talle unico|talle 1|talle 2|talle 3|talle 4)\b/gi;

	const addRaw = (raw) => {
		const value = normalizeSpacing(raw);
		if (!value) return;
		hints.add(value);

		const normalized = normalizeText(value);
		for (const keyword of colorKeywords) {
			if (normalized.includes(keyword)) {
				colors.add(keyword === 'marron' ? 'marron' : keyword);
			}
		}

		for (const match of value.match(sizeRegex) || []) {
			sizes.add(String(match).toUpperCase().replace(/\s+/g, ' '));
		}
	};

	for (const variant of safeArray(variants)) {
		addRaw(variant?.sku);
		addRaw(variant?.option1);
		addRaw(variant?.option2);
		addRaw(variant?.option3);
		for (const value of safeArray(variant?.values)) addRaw(value);
		for (const attribute of safeArray(variant?.attributes)) {
			addRaw(attribute?.name);
			addRaw(attribute?.value);
		}
	}

	return {
		colors: [...colors].slice(0, 8),
		sizes: [...sizes].slice(0, 8),
		hints: [...hints].slice(0, 12)
	};
}

const VERTICAL_KEYWORDS = [
	{
		key: 'indumentaria y accesorios',
		keywords: ['remera', 'campera', 'buzo', 'vestido', 'jean', 'pantalon', 'camisa', 'body', 'calza', 'top', 'lenceria', 'ropa', 'indumentaria', 'accesorio', 'gorra', 'mochila', 'cartera', 'zapatilla']
	},
	{
		key: 'belleza y cuidado personal',
		keywords: ['serum', 'crema', 'shampoo', 'perfume', 'makeup', 'labial', 'skincare', 'belleza', 'cosmetica', 'mascara', 'acondicionador']
	},
	{
		key: 'hogar y deco',
		keywords: ['almohadon', 'silla', 'mesa', 'lampara', 'vajilla', 'cortina', 'deco', 'hogar', 'cocina', 'organizador', 'manta']
	},
	{
		key: 'electronica y tecnologia',
		keywords: ['auricular', 'parlante', 'cable', 'cargador', 'mouse', 'teclado', 'smartwatch', 'tecnologia', 'electronica', 'adaptador']
	},
	{
		key: 'deporte y bienestar',
		keywords: ['fitness', 'deporte', 'yoga', 'mancuerna', 'botella', 'entrenamiento', 'legging deportiva', 'running']
	},
	{
		key: 'mascotas',
		keywords: ['perro', 'gato', 'mascota', 'collar', 'correa', 'comedero', 'pet']
	}
];

function inferVerticalFromText(values = []) {
	const joined = normalizeText(values.join(' '));
	if (!joined) return 'catalogo general';

	let best = { key: 'catalogo general', score: 0 };
	for (const candidate of VERTICAL_KEYWORDS) {
		let score = 0;
		for (const keyword of candidate.keywords) {
			if (joined.includes(keyword)) score += 1;
		}
		if (score > best.score) best = { key: candidate.key, score };
	}

	return best.key;
}

function buildCatalogSummary(products = []) {
	const categoryCounts = new Map();
	const brandCounts = new Map();
	const tagCounts = new Map();
	const colorCounts = new Map();
	const sizeCounts = new Map();
	const sampleProducts = [];
	const sampleSignals = [];
	const prices = [];
	let publishedCount = 0;
	let discountedCount = 0;

	for (const product of products) {
		if (product?.published) publishedCount += 1;
		if (product?.compareAtPrice && product?.price && Number(product.compareAtPrice) > Number(product.price)) {
			discountedCount += 1;
		}

		if (sampleProducts.length < 6 && product?.name) sampleProducts.push(product.name);
		if (product?.price != null) prices.push(Number(product.price));

		if (product?.brand) addCount(brandCounts, product.brand);
		for (const label of collectCategoryLabels(product?.categories)) addCount(categoryCounts, label);
		for (const tag of splitTags(product?.tags)) addCount(tagCounts, tag);

		const variantMeta = extractVariantMeta(product?.variants);
		for (const color of variantMeta.colors) addCount(colorCounts, color);
		for (const size of variantMeta.sizes) addCount(sizeCounts, size);

		sampleSignals.push(
			product?.name || '',
			product?.description || '',
			product?.brand || '',
			...collectCategoryLabels(product?.categories),
			...splitTags(product?.tags),
			...collectAttributeLabels(product?.attributes),
			...variantMeta.hints
		);
	}

	const validPrices = prices.filter((value) => Number.isFinite(value) && value > 0);
	const minPrice = validPrices.length ? Math.min(...validPrices) : null;
	const maxPrice = validPrices.length ? Math.max(...validPrices) : null;

	return {
		totalProducts: products.length,
		publishedProducts: publishedCount,
		discountedProducts: discountedCount,
		priceRange: {
			min: minPrice,
			max: maxPrice,
			label:
				minPrice != null && maxPrice != null
					? `${formatCurrency(minPrice)} a ${formatCurrency(maxPrice)}`
					: 'sin precios confirmados'
		},
		topCategories: topEntries(categoryCounts, 5),
		topBrands: topEntries(brandCounts, 4),
		topTags: topEntries(tagCounts, 6),
		topColors: topEntries(colorCounts, 6),
		topSizes: topEntries(sizeCounts, 6),
		sampleProducts,
		inferredVertical: inferVerticalFromText(sampleSignals)
	};
}

function summarizeLogistics(logisticsConnections = []) {
	const active = safeArray(logisticsConnections).find((item) => String(item?.status || '').toUpperCase() === 'ACTIVE');
	if (!active) return 'No hay integracion logistica confirmada.';
	if (String(active.provider || '').toUpperCase() === 'ENBOX') {
		return 'Opera con Enbox para tracking y gestion logistica.';
	}
	return `Opera con ${active.provider}.`;
}

function summarizePayments(aiConfig = {}) {
	const transfer = aiConfig?.paymentConfig?.transfer || null;
	if (!transfer) return 'No hay datos de transferencia cargados.';

	const parts = [];
	if (transfer.bank) parts.push(`banco ${transfer.bank}`);
	if (transfer.alias) parts.push(`alias ${transfer.alias}`);
	if (transfer.cbu) parts.push('CBU cargado');

	return parts.length
		? `Acepta transferencia bancaria con ${parts.join(', ')}.`
		: 'Tiene configuracion de transferencia cargada.';
}

function summarizePolicies(aiConfig = {}) {
	const policy = aiConfig?.policyConfig || {};
	const fragments = [];
	if (policy.shipping) fragments.push(`Envios: ${normalizeSpacing(policy.shipping)}`);
	if (policy.returns) fragments.push(`Cambios y devoluciones: ${normalizeSpacing(policy.returns)}`);
	if (policy.pickup) fragments.push(`Retiros: ${normalizeSpacing(policy.pickup)}`);
	return fragments;
}

function buildDeterministicDraft(structured) {
	const {
		businessName,
		workspaceName,
		storeName,
		storeUrl,
		provider,
		branding,
		catalog,
		logisticsSummary,
		paymentSummary,
		policySummaries,
		website
	} = structured;

	const lines = [];
	lines.push(`${businessName || workspaceName} es una tienda online ${catalog.inferredVertical}.`);

	if (storeName && normalizeText(storeName) !== normalizeText(businessName || workspaceName)) {
		lines.push(`La tienda figura conectada como ${storeName}.`);
	}

	if (storeUrl) {
		lines.push(`Su tienda publica esta en ${storeUrl}.`);
	}

	if (website?.title) {
		lines.push(`En la web se presenta como: ${website.title}.`);
	}

	if (website?.metaDescription) {
		lines.push(`Descripcion visible de la marca: ${website.metaDescription}.`);
	}

	if (catalog.totalProducts > 0) {
		lines.push(
			`Hoy tiene ${catalog.totalProducts} productos sincronizados${catalog.publishedProducts ? `, con ${catalog.publishedProducts} publicados` : ''}.`
		);
	}

	if (catalog.topCategories.length) {
		lines.push(`Las categorias mas visibles son ${catalog.topCategories.map((item) => item.label).join(', ')}.`);
	}

	if (catalog.sampleProducts.length) {
		lines.push(`Ejemplos del catalogo: ${catalog.sampleProducts.slice(0, 4).join(', ')}.`);
	}

	if (catalog.priceRange.min != null && catalog.priceRange.max != null) {
		lines.push(`El rango de precios detectado va de ${catalog.priceRange.label}.`);
	}

	if (catalog.topColors.length || catalog.topSizes.length) {
		const variantParts = [];
		if (catalog.topColors.length) variantParts.push(`colores frecuentes: ${catalog.topColors.map((item) => item.label).join(', ')}`);
		if (catalog.topSizes.length) variantParts.push(`talles o medidas frecuentes: ${catalog.topSizes.map((item) => item.label).join(', ')}`);
		lines.push(`En variantes aparecen ${variantParts.join(' y ')}.`);
	}

	if (catalog.discountedProducts > 0) {
		lines.push(`Hay al menos ${catalog.discountedProducts} productos con precio promocional o descuento detectado.`);
	}

	lines.push(paymentSummary);
	lines.push(logisticsSummary);

	for (const policy of policySummaries) {
		lines.push(policy);
	}

	if (branding?.primaryColor || branding?.logoUrl) {
		lines.push('La marca ya tiene branding cargado dentro del workspace.');
	}

	lines.push(`La asesora tiene que responder segun datos reales del catalogo y de la operacion ${provider === 'TIENDANUBE' ? 'de Tiendanube' : 'del ecommerce conectado'}, sin inventar stock, variantes ni politicas.`);

	return lines
		.map((line) => normalizeSpacing(line))
		.filter(Boolean)
		.join('\n');
}

function buildStructuredPrompt(structured, deterministicDraft) {
	return [
		'Sos especialista en ecommerce y onboarding comercial para una asesora de ventas por WhatsApp.',
		'Tu tarea es redactar un CONTEXTO COMERCIAL GENERAL reutilizable para esta tienda.',
		'Reglas:',
		'- Usa solo los datos confirmados abajo.',
		'- No inventes politicas, promos, stock, tiempos de envio ni posicionamiento de marca.',
		'- Si falta un dato, omiti ese detalle o deci que no esta confirmado.',
		'- Escribi en espanol claro, natural y operativo.',
		'- Salida final: solo el texto final, sin markdown, sin comillas, sin introduccion.',
		'- Mantene entre 8 y 14 lineas cortas.',
		'- Debe servir para cualquier ecommerce, no solo moda.',
		'Datos confirmados:',
		`- Negocio: ${structured.businessName || structured.workspaceName}`,
		`- Store conectada: ${structured.storeName || 'sin dato'}`,
		`- URL: ${structured.storeUrl || 'sin dato'}`,
		`- Proveedor ecommerce: ${structured.provider || 'sin dato'}`,
		`- Web analizada: ${structured.website?.url || 'sin dato'}`,
		`- Titulo web: ${structured.website?.title || 'sin dato'}`,
		`- Meta descripcion: ${structured.website?.metaDescription || 'sin dato'}`,
		`- Encabezados web: ${[...(structured.website?.h1 || []), ...(structured.website?.h2 || [])].slice(0, 8).join(', ') || 'sin dato'}`,
		`- Rubro inferido por catalogo: ${structured.catalog.inferredVertical}`,
		`- Productos sincronizados: ${structured.catalog.totalProducts}`,
		`- Publicados: ${structured.catalog.publishedProducts}`,
		`- Categorias principales: ${structured.catalog.topCategories.map((item) => item.label).join(', ') || 'sin dato'}`,
		`- Marcas principales: ${structured.catalog.topBrands.map((item) => item.label).join(', ') || 'sin dato'}`,
		`- Productos ejemplo: ${structured.catalog.sampleProducts.join(', ') || 'sin dato'}`,
		`- Rango de precios: ${structured.catalog.priceRange.label}`,
		`- Colores frecuentes: ${structured.catalog.topColors.map((item) => item.label).join(', ') || 'sin dato'}`,
		`- Talles o medidas frecuentes: ${structured.catalog.topSizes.map((item) => item.label).join(', ') || 'sin dato'}`,
		`- Pagos: ${structured.paymentSummary}`,
		`- Logistica: ${structured.logisticsSummary}`,
		`- Politicas: ${structured.policySummaries.join(' | ') || 'sin dato confirmado'}`,
		`- Texto visible web: ${structured.website?.visibleText || 'sin dato'}`,
		'Borrador base:',
		deterministicDraft
	].join('\n');
}

async function runDraftWithAvailableProvider(prompt) {
	const preferred = String(process.env.AI_PROVIDER || 'gemini').toLowerCase();
	const providers = preferred === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];
	let lastError = null;

	for (const provider of providers) {
		try {
			if (provider === 'gemini' && process.env.GEMINI_API_KEY) {
				return await runGeminiReply(prompt, { model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
			}

			if (provider === 'openai' && process.env.OPENAI_API_KEY) {
				return await runOpenAIReply(prompt);
			}
		} catch (error) {
			lastError = error;
			if (provider === 'gemini' && !isRetryableGeminiError(error)) break;
		}
	}

	throw lastError || new Error('No hay proveedor de IA configurado para generar borradores.');
}

export async function generateWorkspaceBusinessContextDraft(workspaceId, options = {}) {
	const workspace = await prisma.workspace.findUnique({
		where: { id: workspaceId },
		include: {
			branding: true,
			aiConfig: true,
			commerceConnections: {
				orderBy: { updatedAt: 'desc' }
			},
			storeInstallations: {
				orderBy: { updatedAt: 'desc' }
			},
			logisticsConnections: {
				orderBy: { updatedAt: 'desc' }
			},
			catalogProducts: {
				where: { published: true },
				orderBy: { syncedAt: 'desc' },
				take: 80
			}
		}
	});

	if (!workspace) {
		const error = new Error('Workspace no encontrado.');
		error.status = 404;
		throw error;
	}

	const connection = safeArray(workspace.commerceConnections)[0] || null;
	const installation = safeArray(workspace.storeInstallations)[0] || null;
	const businessName =
		normalizeSpacing(workspace.aiConfig?.businessName) ||
		normalizeSpacing(workspace.name) ||
		'Marca';
	const storeName =
		normalizeSpacing(connection?.storeName) ||
		normalizeSpacing(installation?.storeName) ||
		'';
	const storeUrl =
		normalizeSpacing(connection?.storeUrl) ||
		normalizeSpacing(installation?.storeUrl) ||
		'';
	const provider = connection?.provider || installation?.provider || 'TIENDANUBE';
	const catalog = buildCatalogSummary(workspace.catalogProducts || []);
	const paymentSummary = summarizePayments(workspace.aiConfig || {});
	const logisticsSummary = summarizeLogistics(workspace.logisticsConnections || []);
	const policySummaries = summarizePolicies(workspace.aiConfig || {});
	const websiteUrl = normalizeSpacing(options.websiteUrl) || storeUrl;
	let website = null;
	const warnings = [];

	if (websiteUrl) {
		try {
			website = await fetchWebsiteSignals(websiteUrl);
		} catch (error) {
			warnings.push(`No se pudo analizar la web: ${error.message}`);
		}
	}

	const structured = {
		workspaceId: workspace.id,
		workspaceName: workspace.name,
		businessName,
		storeName,
		storeUrl,
		provider,
		branding: {
			logoUrl: workspace.branding?.logoUrl || '',
			primaryColor: workspace.branding?.primaryColor || ''
		},
		catalog,
		website,
		paymentSummary,
		logisticsSummary,
		policySummaries
	};

	const deterministicDraft = buildDeterministicDraft(structured);
	if (!catalog.totalProducts) warnings.push('No hay productos publicados sincronizados.');
	if (!storeUrl) warnings.push('No hay URL publica de tienda confirmada.');
	if (!policySummaries.length) warnings.push('No hay politicas operativas confirmadas.');

	try {
		const aiPrompt = buildStructuredPrompt(structured, deterministicDraft);
		const aiResult = await runDraftWithAvailableProvider(aiPrompt);
		const draft = normalizeMultilineText(String(aiResult?.text || '')) || deterministicDraft;
		return {
			draft,
			basis: structured,
			warnings,
			generation: {
				mode: 'ai-assisted',
				provider: aiResult?.provider || null,
				model: aiResult?.model || null
			}
		};
	} catch {
		return {
			draft: deterministicDraft,
			basis: structured,
			warnings,
			generation: {
				mode: 'deterministic',
				provider: null,
				model: null
			}
		};
	}
}
