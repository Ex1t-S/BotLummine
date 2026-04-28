import { prisma } from '../../lib/prisma.js';
import { DEFAULT_WORKSPACE_ID, normalizeWorkspaceId } from '../workspaces/workspace-context.service.js';

const DEFAULT_PANEL_BASE_URL = 'https://enbox.lightdata.com.ar';
const DEFAULT_PUBLIC_BASE_URL = 'https://enbox.lightdata.com.ar';
const DEFAULT_PUBLIC_TRACKING_SALT = 'd54df4s8a';
const BROWSER_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const LIST_COLUMNS = [
	{ id: 161, CDB: 'nombre_fantasia' },
	{ id: 162, CDB: 'ml_vendedor_id' },
	{ id: 163, CDB: 'flexname' },
	{ id: 164, CDB: 'tracking' },
	{ id: 165, CDB: 'fechaventa' },
	{ id: 166, CDB: 'fechagestionar' },
	{ id: 167, CDB: 'nombre' },
	{ id: 168, CDB: 'cp' },
	{ id: 70, CDB: 'zona' },
	{ id: 173, CDB: 'estado_envio' },
];

function normalizeText(value = '') {
	return String(value || '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeRegex(value = '') {
	return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstNonEmpty(...values) {
	for (const value of values) {
		const text = String(value || '').trim();
		if (text) return text;
	}
	return '';
}

function getEnvEnboxConfig() {
	return {
		source: 'env',
		panelBaseUrl: String(process.env.ENBOX_PANEL_BASE_URL || DEFAULT_PANEL_BASE_URL).replace(/\/+$/, ''),
		publicBaseUrl: String(process.env.ENBOX_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, ''),
		publicTrackingSalt: String(process.env.ENBOX_PUBLIC_TRACKING_SALT || DEFAULT_PUBLIC_TRACKING_SALT).trim(),
		username: String(process.env.ENBOX_USERNAME || '').trim(),
		password: String(process.env.ENBOX_PASSWORD || '').trim(),
	};
}

export async function getEnboxConfig({ workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const resolvedWorkspaceId = normalizeWorkspaceId(workspaceId) || DEFAULT_WORKSPACE_ID;
	const connection = await prisma.logisticsConnection.findFirst({
		where: {
			workspaceId: resolvedWorkspaceId,
			provider: 'ENBOX',
			status: 'ACTIVE'
		},
		orderBy: { updatedAt: 'desc' }
	});

	if (connection?.username && connection?.password) {
		const config = connection.config && typeof connection.config === 'object' ? connection.config : {};
		return {
			source: 'database',
			panelBaseUrl: String(config.panelBaseUrl || DEFAULT_PANEL_BASE_URL).replace(/\/+$/, ''),
			publicBaseUrl: String(config.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, ''),
			publicTrackingSalt: String(config.publicTrackingSalt || DEFAULT_PUBLIC_TRACKING_SALT).trim(),
			username: String(connection.username || '').trim(),
			password: String(connection.password || '').trim(),
		};
	}

	if (resolvedWorkspaceId === DEFAULT_WORKSPACE_ID) {
		return getEnvEnboxConfig();
	}

	return {
		source: 'empty',
		panelBaseUrl: DEFAULT_PANEL_BASE_URL,
		publicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
		publicTrackingSalt: DEFAULT_PUBLIC_TRACKING_SALT,
		username: '',
		password: '',
	};
}

function hasEnboxCredentials(config = {}) {
	return Boolean(config.username && config.password);
}

function buildPanelUrl(config = {}, path = '/') {
	return `${config.panelBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildBrowserHeaders(config = {}, sessionCookie = null, extraHeaders = {}) {
	const headers = {
		accept: '*/*',
		origin: config.panelBaseUrl,
		referer: `${config.panelBaseUrl}/index.php`,
		'user-agent': BROWSER_USER_AGENT,
		...extraHeaders,
	};

	if (sessionCookie) {
		headers.cookie = sessionCookie;
	}

	return headers;
}

export function buildPublicTrackingUrl({ publicBaseUrl, publicTrackingSalt }, did, didCliente) {
	if (!did || !didCliente) return null;
	return `${publicBaseUrl}/tracking.php?token=${did}${publicTrackingSalt}${didCliente}`;
}

async function loginToEnbox(config = {}) {
	if (!hasEnboxCredentials(config)) return null;

	const body = new URLSearchParams();
	body.set('user', config.username);
	body.set('pass', config.password);
	body.set('pos', ',');
	body.set('mantener', '1');

	const response = await fetch(buildPanelUrl(config, '/system_user/process_login.php'), {
		method: 'POST',
		headers: buildBrowserHeaders(config, null, {
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			referer: `${config.panelBaseUrl}/`,
			'x-requested-with': 'XMLHttpRequest',
		}),
		body: body.toString(),
	});

	const raw = await response.text();
	let parsed = null;
	try {
		parsed = JSON.parse(raw);
	} catch {
		parsed = null;
	}

	if (!response.ok || !parsed?.estado) {
		return null;
	}

	const setCookie = response.headers.get('set-cookie') || '';
	const sessionCookie = setCookie.split(';')[0].trim();
	return sessionCookie || null;
}

async function warmUpPanelSession(sessionCookie, config = {}) {
	if (!sessionCookie) return;

	try {
		await fetch(buildPanelUrl(config, '/index.php'), {
			headers: buildBrowserHeaders(config, sessionCookie, {
				accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			}),
		});
	} catch {
		// The tracking flow can still work without this warmup.
	}
}

function appendNestedParams(params, prefix, value) {
	if (Array.isArray(value)) {
		value.forEach((item, index) => appendNestedParams(params, `${prefix}[${index}]`, item));
		return;
	}

	if (value && typeof value === 'object') {
		for (const [key, nestedValue] of Object.entries(value)) {
			appendNestedParams(params, `${prefix}[${key}]`, nestedValue);
		}
		return;
	}

	params.append(prefix, String(value ?? ''));
}

async function fetchShipmentRows(sessionCookie, filters = {}, config = {}) {
	if (!sessionCookie) return [];

	const params = new URLSearchParams();
	params.set('cantxpagina', '20');
	params.set('pagina', '1');
	params.set('excel', '0');
	params.set('elim', '0');

	const mergedFilters = {
		asignado: '',
		nombrecliente: '',
		nombre: '',
		cp: '',
		estado: '-1',
		logisticaInversa: '2',
		fecha_desde: '',
		zonasdeentrega: '',
		origen: '',
		cadete: '',
		fecha_hasta: '',
		idml: '',
		tracking_number: '',
		tipo_fecha: '',
		domicilio: '',
		obs: '2',
		turbo: '2',
		tipoClientes: '',
		fotos: '2',
		deposito: '',
		cobranzas: '2',
		metodo: '',
		...filters,
	};

	appendNestedParams(params, 'filtros', mergedFilters);
	appendNestedParams(
		params,
		'columnas',
		LIST_COLUMNS.map((column) => ({
			...column,
			checked: true,
			orden: '',
			radio: false,
			radioSeleccionado: false,
			switchHabilitado: false,
		}))
	);

	const response = await fetch(buildPanelUrl(config, '/modules/envios/listado/procesar_listado.php'), {
		method: 'POST',
		headers: buildBrowserHeaders(config, sessionCookie, {
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'x-requested-with': 'XMLHttpRequest',
		}),
		body: params.toString(),
	});

	const raw = await response.text();
	if (!response.ok || !raw) return [];

	let parsed = null;
	try {
		parsed = JSON.parse(raw);
	} catch {
		parsed = null;
	}

	return Array.isArray(parsed?.rows) ? parsed.rows : [];
}

async function fetchShipmentDetail(sessionCookie, did, config = {}) {
	if (!sessionCookie || !did) return null;

	const params = new URLSearchParams();
	params.set('operador', 'get');
	params.set('did', String(did));

	const response = await fetch(buildPanelUrl(config, '/modules/envios/alta/controlador.php'), {
		method: 'POST',
		headers: buildBrowserHeaders(config, sessionCookie, {
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'x-requested-with': 'XMLHttpRequest',
		}),
		body: params.toString(),
	});

	const raw = await response.text();
	if (!response.ok || !raw) return null;

	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function fetchEnboxShipmentDetailByDid(didEnvio, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const config = await getEnboxConfig({ workspaceId });
	if (!hasEnboxCredentials(config)) return null;

	const normalizedDid = Number(didEnvio || 0);
	if (!normalizedDid) return null;

	const sessionCookie = await loginToEnbox(config);
	if (!sessionCookie) return null;
	await warmUpPanelSession(sessionCookie, config);

	const detail = await fetchShipmentDetail(sessionCookie, normalizedDid, config);
	if (!detail?.header) return null;

	const didCliente = Number(detail?.header?.didCliente || 0) || null;
	const trackingUrl = buildPublicTrackingUrl(config, normalizedDid, didCliente);
	const trackingNumber =
		firstNonEmpty(
			detail?.header?.ml_shipment_id,
			detail?.header?.ml_venta_id,
			detail?.header?.tracking_number
		) || null;

	return {
		ok: Boolean(trackingUrl),
		source: 'enbox-panel',
		reason: trackingUrl ? 'tracking_refreshed' : 'tracking_not_buildable',
		didEnvio: normalizedDid,
		didCliente,
		trackingNumber,
		trackingUrl,
		shippingStatus:
			firstNonEmpty(detail?.header?.estado_envio_nombre, detail?.header?.estado_envio) || null,
		detail,
	};
}

function buildSearchAttempts(order = {}) {
	const raw = order?.raw || {};
	const shippingAddress = raw?.shipping_address || raw?.shippingAddress || {};
	const customerName = firstNonEmpty(
		order.customerName,
		raw?.contact_name,
		raw?.shipping_address?.name,
		raw?.shipping_address?.receiver_name
	);
	const postalCode = firstNonEmpty(
		shippingAddress?.zipcode,
		shippingAddress?.zip_code,
		raw?.shipping_zipcode,
		raw?.billing_zipcode
	);
	const address = firstNonEmpty(
		shippingAddress?.address,
		shippingAddress?.line,
		shippingAddress?.street,
		raw?.shipping_address
	);

	const attempts = [];
	const trimmedName = customerName.trim();
	if (trimmedName) {
		attempts.push({ nombre: trimmedName });
		const firstTwo = trimmedName.split(/\s+/).slice(0, 2).join(' ').trim();
		if (firstTwo && firstTwo !== trimmedName) {
			attempts.push({ nombre: firstTwo });
		}
	}

	if (postalCode) {
		attempts.push({ cp: postalCode });
	}

	if (address) {
		attempts.push({ cp: address });
	}

	if (order.orderNumber) {
		attempts.push({ tracking_number: order.orderNumber });
		attempts.push({ idml: order.orderNumber });
	}

	return attempts.filter((attempt, index, list) => {
		const signature = JSON.stringify(attempt);
		return list.findIndex((item) => JSON.stringify(item) === signature) === index;
	});
}

function scoreShipmentRow(row = {}, order = {}) {
	let score = 0;
	const rowTrackingNumber = normalizeText(row?.tracking || row?.tracking_number || '');
	const rowIdml = normalizeText(row?.ml_vendedor_id || row?.idml || '');

	const rowName = normalizeText(row?.nombre || '');
	const rowCustomer = normalizeText(row?.nombre_fantasia || '');
	const rowAddress = normalizeText(row?.cp || '');
	const orderNumber = normalizeText(order?.orderNumber || '');
	const orderName = normalizeText(order?.customerName || order?.raw?.contact_name || '');
	const shippingAddress = order?.raw?.shipping_address || {};
	const orderPostal = normalizeText(shippingAddress?.zipcode || shippingAddress?.zip_code || '');
	const orderAddress = normalizeText(
		firstNonEmpty(
			shippingAddress?.address,
			shippingAddress?.line,
			shippingAddress?.street,
			order?.raw?.shipping_address
		)
	);

	if (orderName && rowName && rowName.includes(orderName)) score += 45;
	if (orderName && rowName && new RegExp(`\\b${escapeRegex(orderName.split(/\s+/)[0] || '')}\\b`, 'i').test(rowName)) score += 20;
	if (orderName && rowCustomer && rowCustomer.includes(orderName)) score += 12;
	if (orderNumber && rowTrackingNumber && rowTrackingNumber === orderNumber) score += 90;
	if (orderNumber && rowIdml && rowIdml === orderNumber) score += 90;
	if (orderPostal && rowAddress && rowAddress.includes(orderPostal)) score += 18;
	if (orderAddress && rowAddress && (rowAddress.includes(orderAddress) || orderAddress.includes(rowAddress))) score += 15;
	if (rowTrackingNumber) score += 4;

	return score;
}

async function findBestShipmentMatch(order = {}, sessionCookie, config = {}) {
	const attempts = buildSearchAttempts(order);
	const candidates = [];
	const seen = new Set();

	for (const attempt of attempts) {
		const rows = await fetchShipmentRows(sessionCookie, attempt, config);
		for (const row of rows) {
			const did = Number(row?.did || 0);
			if (!did || seen.has(did)) continue;
			seen.add(did);
			candidates.push({ ...row, _score: scoreShipmentRow(row, order) });
		}
		if (candidates.some((item) => item._score >= 50)) {
			break;
		}
	}

	return candidates.sort((a, b) => b._score - a._score)[0] || null;
}

export async function resolveEnboxTracking(order = {}, { workspaceId = DEFAULT_WORKSPACE_ID } = {}) {
	const config = await getEnboxConfig({ workspaceId });
	if (!hasEnboxCredentials(config)) return null;

	const sessionCookie = await loginToEnbox(config);
	if (!sessionCookie) return null;
	await warmUpPanelSession(sessionCookie, config);

	const row = await findBestShipmentMatch(order, sessionCookie, config);
	if (!row?.did) {
		return {
			ok: false,
			source: 'enbox-panel',
			reason: 'shipment_not_found',
		};
	}

	const detail = await fetchShipmentDetail(sessionCookie, row.did, config);
	const didCliente = Number(detail?.header?.didCliente || row?.didCliente || 0) || null;
	const trackingUrl = buildPublicTrackingUrl(config, row.did, didCliente);

	return {
		ok: Boolean(trackingUrl),
		source: 'enbox-panel',
		reason: trackingUrl ? 'tracking_resolved' : 'tracking_not_buildable',
		didEnvio: Number(row.did),
		didCliente,
		trackingNumber: row?.tracking || row?.tracking_number || row?.ml_vendedor_id || row?.idml || null,
		trackingUrl,
		shippingStatus: detail?.header?.estado_envio_nombre || detail?.header?.estado_envio || null,
		row,
		detail,
	};
}
