import { prisma } from '../../lib/prisma.js';
import { getOrderByNumber } from '../tiendanube/orders.service.js';
import {
	buildPublicTrackingUrl,
	fetchEnboxShipmentDetailByDid,
	getEnboxConfig,
	resolveEnboxTracking,
} from './enbox.service.js';

const BACKFILL_LOOKBACK_DAYS = Math.max(7, Number(process.env.ENBOX_BACKFILL_LOOKBACK_DAYS || 30));
const RECENT_LOOKBACK_DAYS = Math.max(1, Number(process.env.ENBOX_RECENT_LOOKBACK_DAYS || 3));
const BACKFILL_BATCH_SIZE = Math.max(10, Number(process.env.ENBOX_BACKFILL_BATCH_SIZE || 150));
const INCREMENTAL_BATCH_SIZE = Math.max(5, Number(process.env.ENBOX_INCREMENTAL_BATCH_SIZE || 40));
const REFRESH_BATCH_SIZE = Math.max(5, Number(process.env.ENBOX_REFRESH_BATCH_SIZE || 120));
const SYNC_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.ENBOX_SYNC_INTERVAL_MS || 15 * 60 * 1000));
const STARTUP_DELAY_MS = Math.max(5_000, Number(process.env.ENBOX_SYNC_STARTUP_DELAY_MS || 15_000));
const DISCOVERY_SEED_DID = Math.max(1, Number(process.env.ENBOX_DISCOVERY_SEED_DID || 332490));
const BACKFILL_DID_WINDOW = Math.max(50, Number(process.env.ENBOX_BACKFILL_DID_WINDOW || 1500));
const INCREMENTAL_DID_WINDOW = Math.max(20, Number(process.env.ENBOX_INCREMENTAL_DID_WINDOW || 180));
const DISCOVERY_CONCURRENCY = Math.max(1, Math.min(10, Number(process.env.ENBOX_DISCOVERY_CONCURRENCY || 4)));

const syncState = {
	running: false,
	lastMode: null,
	startedAt: null,
	finishedAt: null,
	message: 'Sin sincronizaciones de Enbox todavía.',
	shipmentsChecked: 0,
	shipmentsUpserted: 0,
	ordersScanned: 0,
	ordersMatched: 0,
	errors: [],
};

let schedulerTimer = null;

function pushError(message) {
	syncState.errors.push({ message, at: new Date().toISOString() });
	syncState.message = message;
	console.error(`[ENBOX SYNC] ${message}`);
}

function resetSyncState(mode) {
	syncState.running = true;
	syncState.lastMode = mode;
	syncState.startedAt = new Date().toISOString();
	syncState.finishedAt = null;
	syncState.message = `Preparando sincronización Enbox (${mode}).`;
	syncState.shipmentsChecked = 0;
	syncState.shipmentsUpserted = 0;
	syncState.ordersScanned = 0;
	syncState.ordersMatched = 0;
	syncState.errors = [];
	console.log(`[ENBOX SYNC] iniciando modo=${mode}`);
}

function finishSyncState(message) {
	syncState.running = false;
	syncState.finishedAt = new Date().toISOString();
	syncState.message = message;
	console.log(
		`[ENBOX SYNC] finalizado modo=${syncState.lastMode} checked=${syncState.shipmentsChecked} upserted=${syncState.shipmentsUpserted} scanned=${syncState.ordersScanned} matched=${syncState.ordersMatched} message="${message}"`
	);
}

function subtractDays(days) {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function cleanString(value) {
	const text = String(value ?? '').trim();
	return text || null;
}

const TARGET_CLIENT_ID = cleanString(process.env.ENBOX_TARGET_CLIENT_ID || '90');

function normalizeText(value) {
	return String(value ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

async function mapInBatches(items, worker, concurrency = DISCOVERY_CONCURRENCY) {
	const results = [];
	for (let index = 0; index < items.length; index += concurrency) {
		const chunk = items.slice(index, index + concurrency);
		const chunkResults = await Promise.all(chunk.map(worker));
		results.push(...chunkResults);
	}
	return results;
}

function buildTrackingToken(didEnvio, didCliente) {
	const config = getEnboxConfig();
	if (!didEnvio || !didCliente) return null;
	return `${didEnvio}${config.publicTrackingSalt}${didCliente}`;
}

function extractShippingCarrier(raw = {}) {
	return (
		cleanString(raw?.shipping_option?.name) ||
		cleanString(raw?.shipping_carrier) ||
		cleanString(raw?.shipping_address?.shipping_option_name) ||
		null
	);
}

function isLikelyEnboxCarrier(raw = {}) {
	const haystack = normalizeText(
		[
			extractShippingCarrier(raw),
			raw?.shipping_status,
			raw?.shipping_suboption,
			raw?.gateway_name,
		]
			.filter(Boolean)
			.join(' ')
	);

	return /\benbox\b|\bbox\b|envio flex gba|envio flex/i.test(haystack);
}

function normalizeShipmentRecord(source = {}) {
	const detailHeader = source?.detail?.header || {};
	const row = source?.row || {};
	const didEnvio = cleanString(source?.didEnvio || row?.did || detailHeader?.did);
	const didCliente = cleanString(source?.didCliente || row?.didCliente || detailHeader?.didCliente);
	const orderNumber =
		cleanString(source?.orderNumber) ||
		cleanString(detailHeader?.ml_venta_id) ||
		cleanString(row?.ml_vendedor_id);
	const shipmentNumber =
		cleanString(source?.shipmentNumber) ||
		cleanString(detailHeader?.ml_shipment_id) ||
		cleanString(row?.tracking);
	const packId = cleanString(detailHeader?.ml_pack_id);
	const trackingNumber = cleanString(source?.trackingNumber || shipmentNumber || orderNumber);
	const trackingUrl =
		cleanString(source?.trackingUrl) || buildPublicTrackingUrl(getEnboxConfig(), didEnvio, didCliente);
	const shippingStatusCode = cleanString(detailHeader?.estado_envio);
	const shippingStatus = cleanString(source?.shippingStatus || detailHeader?.estado_envio_nombre || shippingStatusCode);
	const recipientName = cleanString(detailHeader?.destination_receiver_name || row?.nombre);
	const recipientPhone = cleanString(detailHeader?.destination_receiver_phone);
	const recipientEmail = cleanString(detailHeader?.destination_receiver_email);
	const postalCode = cleanString(detailHeader?.destination_shipping_zip_code || row?.cp);
	const addressLine = cleanString(detailHeader?.destination_shipping_address_line);
	const shippingMethod = cleanString(detailHeader?.lead_time_shipping_method_name);

	return {
		didEnvio,
		didCliente,
		orderNumber,
		shipmentNumber,
		packId,
		trackingNumber,
		trackingToken: buildTrackingToken(didEnvio, didCliente),
		trackingUrl,
		shippingStatus,
		shippingStatusCode,
		recipientName,
		recipientPhone,
		recipientEmail,
		postalCode,
		addressLine,
		shippingMethod,
		source: cleanString(source?.source) || 'enbox-panel',
		rawSummary: source?.row || null,
		rawPayload: source?.detail || null,
		lastSyncedAt: new Date(),
	};
}

async function upsertEnboxShipment(source = {}) {
	const data = normalizeShipmentRecord(source);
	if (!data.didEnvio) return null;

	const record = await prisma.enboxShipment.upsert({
		where: { didEnvio: data.didEnvio },
		create: {
			...data,
			storeId: cleanString(source?.storeId),
			orderId: cleanString(source?.orderId),
			discoveredAt: new Date(),
		},
		update: {
			...data,
			storeId: cleanString(source?.storeId),
			orderId: cleanString(source?.orderId),
		},
	});

	syncState.shipmentsUpserted += 1;
	return record;
}

async function refreshKnownShipments(limit = REFRESH_BATCH_SIZE) {
	console.log(`[ENBOX SYNC] refrescando envíos conocidos limit=${limit}`);
	const rows = await prisma.enboxShipment.findMany({
		orderBy: [{ lastSyncedAt: 'asc' }, { updatedAt: 'asc' }],
		take: limit,
	});

	for (const row of rows) {
		syncState.shipmentsChecked += 1;
		const refreshed = await fetchEnboxShipmentDetailByDid(row.didEnvio).catch(() => null);
		if (!refreshed?.detail?.header) continue;
		await upsertEnboxShipment({
			...refreshed,
			storeId: row.storeId,
			orderId: row.orderId,
			orderNumber: row.orderNumber,
			source: 'enbox-refresh',
		});
	}
}

async function getDiscoverySeedDid() {
	const latestKnown = await prisma.enboxShipment.findFirst({
		orderBy: [{ updatedAt: 'desc' }, { didEnvio: 'desc' }],
		select: { didEnvio: true },
	});

	const parsedKnown = Number(latestKnown?.didEnvio || 0);
	if (parsedKnown > 0) return parsedKnown;
	return DISCOVERY_SEED_DID;
}

function buildDidRange(seedDid, mode = 'incremental') {
	const backwardWindow = mode === 'backfill' ? BACKFILL_DID_WINDOW : INCREMENTAL_DID_WINDOW;
	const forwardWindow = mode === 'backfill' ? Math.max(50, Math.floor(backwardWindow * 0.08)) : Math.max(20, Math.floor(backwardWindow * 0.2));
	const lowerBound = Math.max(1, seedDid - backwardWindow);
	const upperBound = seedDid + forwardWindow;
	const dids = [];

	for (let did = upperBound; did >= lowerBound; did -= 1) {
		dids.push(did);
	}

	return dids;
}

async function crawlDidWindow(mode = 'incremental') {
	const seedDid = await getDiscoverySeedDid();
	const dids = buildDidRange(seedDid, mode);

	console.log(`[ENBOX SYNC] crawl did window mode=${mode} seed=${seedDid} total=${dids.length}`);

	await mapInBatches(
		dids,
		async (didEnvio) => {
			syncState.shipmentsChecked += 1;
			const detailResult = await fetchEnboxShipmentDetailByDid(didEnvio).catch(() => null);
			const detail = detailResult?.detail?.header || null;
			if (!detail) return null;

			const didCliente = cleanString(detail?.didCliente);
			if (TARGET_CLIENT_ID && didCliente && didCliente !== TARGET_CLIENT_ID) {
				return null;
			}

			return upsertEnboxShipment({
				...detailResult,
				orderNumber: cleanString(detail?.ml_venta_id) || cleanString(detail?.ml_shipment_id),
				source: 'enbox-did-crawl',
			});
		},
		DISCOVERY_CONCURRENCY
	);
}

async function getCandidateOrders(mode = 'incremental') {
	const since = subtractDays(mode === 'backfill' ? BACKFILL_LOOKBACK_DAYS : RECENT_LOOKBACK_DAYS);
	const take = mode === 'backfill' ? BACKFILL_BATCH_SIZE : INCREMENTAL_BATCH_SIZE;

	const orders = await prisma.customerOrder.findMany({
		where: {
			orderCreatedAt: { gte: since },
			orderNumber: { not: null },
		},
		orderBy: [{ orderCreatedAt: 'desc' }, { createdAt: 'desc' }],
		take,
		select: {
			id: true,
			storeId: true,
			orderId: true,
			orderNumber: true,
			contactName: true,
			rawPayload: true,
		},
	});

	return orders;
}

async function discoverRecentShipments(mode = 'incremental') {
	const candidates = await getCandidateOrders(mode);
	console.log(`[ENBOX SYNC] candidatos mode=${mode} total=${candidates.length}`);

	for (const candidate of candidates) {
		syncState.ordersScanned += 1;

		const raw = candidate.rawPayload && typeof candidate.rawPayload === 'object' ? candidate.rawPayload : {};
		const normalizedOrderNumber = cleanString(candidate.orderNumber);
		const cacheMatchers = [
			normalizedOrderNumber ? { orderNumber: normalizedOrderNumber } : null,
			normalizedOrderNumber ? { shipmentNumber: normalizedOrderNumber } : null,
		].filter(Boolean);
		const cached = await prisma.enboxShipment.findFirst({
			where: cacheMatchers.length ? { OR: cacheMatchers } : undefined,
			orderBy: { updatedAt: 'desc' },
		});

		if (cached && mode !== 'backfill') {
			continue;
		}

		if (cached?.didEnvio) {
			syncState.ordersMatched += 1;
			continue;
		}

		let liveOrder = null;
		try {
			liveOrder = await getOrderByNumber(candidate.orderNumber);
		} catch (error) {
			pushError(`No se pudo cargar pedido ${candidate.orderNumber} desde Tiendanube: ${error?.message || error}`);
			continue;
		}

		if (!liveOrder) continue;

		const likelyEnbox =
			/enbox/i.test(String(liveOrder.shippingCarrier || '')) ||
			isLikelyEnboxCarrier(liveOrder.raw) ||
			isLikelyEnboxCarrier(raw);

		if (!likelyEnbox) {
			continue;
		}

		const resolved = await resolveEnboxTracking(liveOrder).catch(() => null);
		if (!resolved?.didEnvio) continue;

		syncState.ordersMatched += 1;
		await upsertEnboxShipment({
			...resolved,
			storeId: candidate.storeId,
			orderId: candidate.orderId,
			orderNumber: cleanString(candidate.orderNumber),
			source: 'enbox-discovery',
		});
	}
}

function safeSyncLogData(data = {}) {
	return {
		status: data.status,
		mode: data.mode,
		startedAt: data.startedAt,
		finishedAt: data.finishedAt ?? null,
		shipmentsChecked: Number(data.shipmentsChecked || 0),
		shipmentsUpserted: Number(data.shipmentsUpserted || 0),
		ordersScanned: Number(data.ordersScanned || 0),
		ordersMatched: Number(data.ordersMatched || 0),
		message: data.message || null,
	};
}

export function getEnboxSyncStatus() {
	return { ...syncState, errors: syncState.errors.slice(-10) };
}

export async function findCachedEnboxShipment(orderNumber) {
	const normalizedOrderNumber = cleanString(orderNumber);
	if (!normalizedOrderNumber) return null;

	return prisma.enboxShipment.findFirst({
		where: {
			OR: [
				{ orderNumber: normalizedOrderNumber },
				{ shipmentNumber: normalizedOrderNumber },
				{ trackingNumber: normalizedOrderNumber },
				{ packId: normalizedOrderNumber },
			],
		},
		orderBy: [{ lastSyncedAt: 'desc' }, { updatedAt: 'desc' }],
	});
}

export async function syncEnboxShipments({ mode = 'incremental' } = {}) {
	if (syncState.running) {
		return { ok: true, started: false, ...getEnboxSyncStatus() };
	}

	const config = getEnboxConfig();
	if (!config.username || !config.password) {
		return {
			ok: false,
			started: false,
			message: 'Faltan credenciales de Enbox.',
		};
	}

	resetSyncState(mode);

	let syncLog = null;

	try {
		console.log(`[ENBOX SYNC] creando log mode=${mode}`);
		syncLog = await prisma.enboxSyncLog.create({
			data: safeSyncLogData({
				status: 'RUNNING',
				mode,
				startedAt: new Date(),
				message: `Sincronización Enbox iniciada (${mode}).`,
			}),
		});
	} catch {
		console.warn(`[ENBOX SYNC] no se pudo crear EnboxSyncLog mode=${mode}`);
		syncLog = null;
	}

	try {
		await refreshKnownShipments();
		await crawlDidWindow(mode);
		await discoverRecentShipments(mode);

		const successMessage =
			mode === 'backfill'
				? 'Backup Enbox del último mes completado.'
				: 'Sincronización incremental de Enbox completada.';

		finishSyncState(successMessage);

		if (syncLog?.id) {
			await prisma.enboxSyncLog.update({
				where: { id: syncLog.id },
				data: safeSyncLogData({
					status: 'SUCCESS',
					mode,
					finishedAt: new Date(),
					shipmentsChecked: syncState.shipmentsChecked,
					shipmentsUpserted: syncState.shipmentsUpserted,
					ordersScanned: syncState.ordersScanned,
					ordersMatched: syncState.ordersMatched,
					message: syncState.message,
				}),
			});
		}

		return { ok: true, started: true, ...getEnboxSyncStatus() };
	} catch (error) {
		pushError(error?.message || 'Error sincronizando envíos de Enbox.');
		finishSyncState(syncState.message);

		if (syncLog?.id) {
			try {
				await prisma.enboxSyncLog.update({
					where: { id: syncLog.id },
					data: safeSyncLogData({
						status: 'ERROR',
						mode,
						finishedAt: new Date(),
						shipmentsChecked: syncState.shipmentsChecked,
						shipmentsUpserted: syncState.shipmentsUpserted,
						ordersScanned: syncState.ordersScanned,
						ordersMatched: syncState.ordersMatched,
						message: syncState.message,
					}),
				});
			} catch {
				// no-op
			}
		}

		return { ok: false, started: true, ...getEnboxSyncStatus() };
	}
}

export function startEnboxSyncScheduler() {
	if (String(process.env.ENBOX_SYNC_ENABLED || 'true').trim().toLowerCase() === 'false') {
		console.log('[ENBOX SYNC] deshabilitado por configuración.');
		return;
	}

	if (schedulerTimer) return;

	setTimeout(() => {
		syncEnboxShipments({ mode: 'backfill' }).catch((error) => {
			console.error('[ENBOX SYNC] error en backfill inicial', error);
		});
	}, STARTUP_DELAY_MS);

	schedulerTimer = setInterval(() => {
		syncEnboxShipments({ mode: 'incremental' }).catch((error) => {
			console.error('[ENBOX SYNC] error en sincronización incremental', error);
		});
	}, SYNC_INTERVAL_MS);

	if (typeof schedulerTimer.unref === 'function') {
		schedulerTimer.unref();
	}

	console.log(`[ENBOX SYNC] activo cada ${SYNC_INTERVAL_MS} ms.`);
}
