const STATUS_ALIASES = {
	preparing: ['unpacked', 'unshipped', 'unfulfilled', 'preparing', 'preparacion', 'preparando'],
	packed: ['packed', 'partially_packed', 'embalado'],
	dispatched: [
		'shipped',
		'fulfilled',
		'partially_fulfilled',
		'dispatched',
		'in_transit',
		'in transit',
		'en camino',
		'en transito',
		'despachado',
		'despach',
		'envio en curso',
	],
	delivered: ['delivered', 'entregado'],
	cancelled: ['cancelled', 'canceled', 'cancelado'],
};

const CATEGORY_LABELS = {
	preparing: 'En preparación',
	packed: 'Embalado',
	dispatched: 'Despachado',
	delivered: 'Entregado',
	cancelled: 'Cancelado',
	unknown: 'Sin dato',
};

function normalizeText(value = '') {
	return String(value || '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

function safeString(value) {
	if (value && typeof value === 'object') return null;
	const text = String(value ?? '').trim();
	return text || null;
}

function flattenValues(value, output = []) {
	if (value == null) return output;
	if (Array.isArray(value)) {
		for (const item of value) flattenValues(item, output);
		return output;
	}
	if (typeof value === 'object') {
		for (const item of Object.values(value)) flattenValues(item, output);
		return output;
	}
	output.push(value);
	return output;
}

function collectOrderShippingTexts(order = {}) {
	const fulfillments = [
		...(Array.isArray(order?.fulfillments) ? order.fulfillments : []),
		...(Array.isArray(order?.fulfillment_orders) ? order.fulfillment_orders : []),
	];

	return [
		order?.shipping_status,
		order?.shippingStatus,
		order?.fulfillment_status,
		order?._fulfillmentStatus,
		order?.status,
		...fulfillments.flatMap((item) => [
			item?.status,
			item?.shipping_status,
			item?.fulfillment_status,
			item?.tracking_info?.status,
			item?.tracking_info?.state,
		]),
	]
		.map(safeString)
		.filter(Boolean);
}

export function getShippingStatusCategory(value = '') {
	const normalized = normalizeText(value);
	if (!normalized) return 'unknown';

	for (const category of ['delivered', 'cancelled', 'dispatched', 'preparing', 'packed']) {
		if (STATUS_ALIASES[category].some((alias) => normalized.includes(normalizeText(alias)))) {
			return category;
		}
	}

	return 'unknown';
}

export function getShippingStatusMeta(value = '') {
	const category = getShippingStatusCategory(value);
	return {
		category,
		label: CATEGORY_LABELS[category] || CATEGORY_LABELS.unknown,
	};
}

export function isDispatchedShippingStatus(value = '', { includeDelivered = false } = {}) {
	const category = getShippingStatusCategory(value);
	return category === 'dispatched' || (includeDelivered && category === 'delivered');
}

export function getShippingStatusSearchTerms(categories = []) {
	const selected = new Set(categories);
	return [...selected].flatMap((category) => STATUS_ALIASES[category] || []);
}

export function hasCorreoArgentinoSignal(value = '') {
	const normalized = normalizeText(value);
	return normalized.includes('correo argentino') || normalized.includes('correoarg') || normalized.includes('oca correo');
}

export function extractOrderShippingSignals(order = {}) {
	const fulfillments = [
		...(Array.isArray(order?.fulfillments) ? order.fulfillments : []),
		...(Array.isArray(order?.fulfillment_orders) ? order.fulfillment_orders : []),
	];

	const directTrackingNumber =
		safeString(order?.shipping_tracking_number) ||
		safeString(order?.tracking_number) ||
		safeString(order?.trackingNumber);
	const directTrackingUrl =
		safeString(order?.shipping_tracking_url) ||
		safeString(order?.tracking_url) ||
		safeString(order?.trackingUrl);
	const directCarrier =
		safeString(order?.shipping_carrier) ||
		safeString(order?.shippingCarrier) ||
		safeString(order?.shipping_option?.name) ||
		safeString(order?.shipping_option) ||
		safeString(order?.shipping?.carrier?.name) ||
		safeString(order?.shipping?.option?.name) ||
		safeString(order?._shippingCarrierName);

	const fulfillmentSignals = fulfillments.map((item) => {
		const trackingInfo = item?.tracking_info || {};
		return {
			trackingNumber:
				safeString(trackingInfo?.code) ||
				safeString(trackingInfo?.number) ||
				safeString(item?.tracking_number) ||
				safeString(item?.shipping_tracking_number),
			trackingUrl:
				safeString(trackingInfo?.url) ||
				safeString(item?.tracking_url) ||
				safeString(item?.shipping_tracking_url),
			carrierName:
				safeString(trackingInfo?.carrier) ||
				safeString(trackingInfo?.carrier_name) ||
				safeString(item?.shipping?.carrier?.name) ||
				safeString(item?.shipping?.option?.name) ||
				safeString(item?.carrier_name),
			status:
				safeString(item?.status) ||
				safeString(item?.shipping_status) ||
				safeString(item?.fulfillment_status),
		};
	});

	const firstFulfillmentWithSignal =
		fulfillmentSignals.find((item) => item.trackingNumber || item.trackingUrl || item.carrierName || item.status) || {};

	const trackingNumber = directTrackingNumber || firstFulfillmentWithSignal.trackingNumber || null;
	const trackingUrl = directTrackingUrl || firstFulfillmentWithSignal.trackingUrl || null;
	const carrierName = directCarrier || firstFulfillmentWithSignal.carrierName || null;
	const fulfillmentStatus = firstFulfillmentWithSignal.status || safeString(order?._fulfillmentStatus) || null;
	const shippingOptionText = flattenValues([
		order?.shipping_option,
		order?.shipping,
		order?.shipping_carrier,
		carrierName,
	]).join(' ');

	return {
		trackingNumber,
		trackingUrl,
		carrierName,
		fulfillmentStatus,
		hasTracking: Boolean(trackingNumber || trackingUrl),
		hasCorreoArgentino: hasCorreoArgentinoSignal(
			[trackingNumber, trackingUrl, carrierName, shippingOptionText].filter(Boolean).join(' ')
		),
	};
}

export function deriveShippingStatus(order = {}) {
	const statusTexts = collectOrderShippingTexts(order);
	const signals = extractOrderShippingSignals(order);

	if (statusTexts.some((value) => getShippingStatusCategory(value) === 'delivered')) return 'delivered';
	if (statusTexts.some((value) => getShippingStatusCategory(value) === 'cancelled')) return 'cancelled';
	if (statusTexts.some((value) => getShippingStatusCategory(value) === 'dispatched')) return 'dispatched';
	if (signals.hasCorreoArgentino || signals.hasTracking) return 'dispatched';
	if (statusTexts.some((value) => getShippingStatusCategory(value) === 'packed')) return 'packed';
	if (statusTexts.some((value) => getShippingStatusCategory(value) === 'preparing')) return 'preparing';

	return safeString(order?.shipping_status) || safeString(order?.shippingStatus) || null;
}
