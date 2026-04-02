import { prisma } from '../lib/prisma.js';

const TIENDANUBE_API_VERSION = process.env.TIENDANUBE_API_VERSION || '2025-03';
const CUSTOMERS_PER_PAGE = Math.min(
	200,
	Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_PER_PAGE || 200))
);
const MAX_PAGES = Math.max(1, Number(process.env.TIENDANUBE_CUSTOMERS_SYNC_MAX_PAGES || 500));
const RUNNING_LOCK_MINUTES = Math.max(
	5,
	Number(process.env.CUSTOMERS_SYNC_LOCK_MINUTES || 30)
);

export class CustomerSyncConflictError extends Error {
	constructor(message = 'Ya hay una sincronización de clientes en curso.') {
		super(message);
		this.name = 'CustomerSyncConflictError';
		this.statusCode = 409;
	}
}

function normalizePhone(value = '') {
	const digits = String(value || '').replace(/\D/g, '');
	return digits || null;
}

function normalizeEmail(value = '') {
	const email = String(value || '').trim().toLowerCase();
	return email || null;
}

function cleanString(value = '') {
	const text = String(value ?? '').trim();
	return text || null;
}

function parseDateOrNull(value) {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toDecimalOrNull(value) {
	if (value === null || value === undefined || value === '') return null;
	return String(value);
}

function buildHeaders(accessToken) {
	return {
		Authentication: `bearer ${accessToken}`,
		'Content-Type': 'application/json; charset=utf-8',
		'User-Agent': process.env.TIENDANUBE_USER_AGENT || 'Lummine IA Assistant',
	};
}

function hasSameLegacyIdentity(profile, payload) {
	return Boolean(
		(payload.normalizedEmail && profile.normalizedEmail === payload.normalizedEmail) ||
			(payload.normalizedPhone && profile.normalizedPhone === payload.normalizedPhone)
	);
}

function compareProfiles(a, b) {
	const score = (profile) => {
		let value = 0;
		if (profile.externalCustomerId) value += 1000;
		if (profile.lastOrderId) value += 100;
		value += Number(profile.orderCount || 0) * 10;
		if (profile.totalSpent) value += Number(profile.totalSpent || 0) > 0 ? 5 : 0;
		if (profile.updatedAt) value += new Date(profile.updatedAt).getTime() / 1e13;
		return value;
	};

	return score(b) - score(a);
}

function buildCustomerProfilePayload(customer = {}, storeId) {
	return {
		storeId,
		externalCustomerId: customer?.id ? String(customer.id) : null,
		displayName: cleanString(customer?.name),
		email: cleanString(customer?.email),
		normalizedEmail: normalizeEmail(customer?.email),
		phone: cleanString(customer?.phone),
		normalizedPhone: normalizePhone(customer?.phone),
		identification: cleanString(customer?.identification),
		note: cleanString(customer?.note),
		acceptsMarketing:
			typeof customer?.accepts_marketing === 'boolean' ? customer.accepts_marketing : null,
		acceptsMarketingUpdatedAt: parseDateOrNull(customer?.accepts_marketing_updated_at),
		defaultAddress: customer?.default_address ?? null,
		addresses: Array.isArray(customer?.addresses) ? customer.addresses : null,
		billingAddress: cleanString(customer?.billing_address),
		billingNumber: cleanString(customer?.billing_number),
		billingFloor: cleanString(customer?.billing_floor),
		billingLocality: cleanString(customer?.billing_locality),
		billingZipcode: cleanString(customer?.billing_zipcode),
		billingCity: cleanString(customer?.billing_city),
		billingProvince: cleanString(customer?.billing_province),
		billingCountry: cleanString(customer?.billing_country),
		billingPhone: cleanString(customer?.billing_phone),
		totalSpent: toDecimalOrNull(customer?.total_spent),
		currency: cleanString(customer?.total_spent_currency),
		lastOrderId: customer?.last_order_id ? String(customer.last_order_id) : null,
		firstOrderAt: null,
		lastOrderAt: null,
		lastOrderNumber: null,
		lastPaymentStatus: null,
		lastShippingStatus: null,
		productSummary: null,
		rawCustomerPayload: customer,
		rawLastOrderPayload: null,
		syncedAt: new Date(),
	};
}

function pick(existingValue, incomingValue) {
	if (incomingValue === null || incomingValue === undefined) return existingValue;
	if (typeof incomingValue === 'string' && !incomingValue.trim()) return existingValue;
	return incomingValue;
}

async function resolveStoreCredentials() {
	const installation = await prisma.storeInstallation.findFirst({
		orderBy: { installedAt: 'desc' },
	});

	const storeId = installation?.storeId || process.env.TIENDANUBE_STORE_ID || null;
	const accessToken = installation?.accessToken || process.env.TIENDANUBE_ACCESS_TOKEN || null;

	if (!storeId || !accessToken) {
		throw new Error(
			'Faltan credenciales de Tiendanube. Necesitás StoreInstallation o TIENDANUBE_STORE_ID / TIENDANUBE_ACCESS_TOKEN en el .env.'
		);
	}

	return { storeId, accessToken };
}

async function acquireSyncLock(storeId) {
	const cutoff = new Date(Date.now() - RUNNING_LOCK_MINUTES * 60 * 1000);

	await prisma.customerSyncLog.updateMany({
		where: {
			storeId,
			status: 'RUNNING',
			startedAt: { lt: cutoff },
			finishedAt: null,
		},
		data: {
			status: 'FAILED',
			finishedAt: new Date(),
			message: 'Se marcó como fallida por lock vencido.',
		},
	});

	const running = await prisma.customerSyncLog.findFirst({
		where: {
			storeId,
			status: 'RUNNING',
			finishedAt: null,
		},
		orderBy: { startedAt: 'desc' },
	});

	if (running) {
		throw new CustomerSyncConflictError();
	}

	return prisma.customerSyncLog.create({
		data: {
			storeId,
			status: 'RUNNING',
			fullSync: false,
			message: 'Sincronización rápida de clientes iniciada.',
		},
	});
}

async function finalizeSyncLog(logId, data) {
	return prisma.customerSyncLog.update({
		where: { id: logId },
		data: {
			...data,
			finishedAt: new Date(),
		},
	});
}

async function fetchCustomersPage({ storeId, accessToken, page, q = '' }) {
	const fields = [
		'id',
		'name',
		'email',
		'phone',
		'identification',
		'note',
		'default_address',
		'addresses',
		'billing_address',
		'billing_number',
		'billing_floor',
		'billing_locality',
		'billing_zipcode',
		'billing_city',
		'billing_province',
		'billing_country',
		'billing_phone',
		'total_spent',
		'total_spent_currency',
		'last_order_id',
		'accepts_marketing',
		'accepts_marketing_updated_at',
		'created_at',
		'updated_at',
	].join(',');

	const params = new URLSearchParams({
		page: String(page),
		per_page: String(CUSTOMERS_PER_PAGE),
		fields,
	});

	if (q) {
		params.set('q', q);
	}

	const url = `https://api.tiendanube.com/${TIENDANUBE_API_VERSION}/${storeId}/customers?${params.toString()}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: buildHeaders(accessToken),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Tiendanube customers error ${response.status}: ${text}`);
	}

	const data = await response.json();
	if (!Array.isArray(data)) {
		throw new Error('La respuesta de Tiendanube en /customers no fue una lista.');
	}

	return data;
}

async function findMatchingProfiles(storeId, payload) {
	const or = [];

	if (payload.externalCustomerId) {
		or.push({ externalCustomerId: payload.externalCustomerId });
	}
	if (payload.normalizedEmail) {
		or.push({ normalizedEmail: payload.normalizedEmail });
	}
	if (payload.normalizedPhone) {
		or.push({ normalizedPhone: payload.normalizedPhone });
	}

	if (!or.length) return [];

	return prisma.customerProfile.findMany({
		where: {
			storeId,
			OR: or,
		},
		select: {
			id: true,
			externalCustomerId: true,
			normalizedEmail: true,
			normalizedPhone: true,
			orderCount: true,
			totalSpent: true,
			lastOrderId: true,
			updatedAt: true,
		},
	});
}

async function mergeProfilesIntoKeeper(keeperId, duplicateIds = []) {
	if (!duplicateIds.length) return 0;

	await prisma.$transaction(async (tx) => {
		await tx.customerOrder.updateMany({
			where: { customerProfileId: { in: duplicateIds } },
			data: { customerProfileId: keeperId },
		});

		await tx.customerProfile.deleteMany({
			where: { id: { in: duplicateIds } },
		});
	});

	return duplicateIds.length;
}

function pickKeeper(candidates = []) {
	return [...candidates].sort(compareProfiles)[0] || null;
}

async function upsertCustomerProfile(payload) {
	const matches = await findMatchingProfiles(payload.storeId, payload);

	const exactMatches = matches.filter(
		(profile) =>
			payload.externalCustomerId && profile.externalCustomerId === payload.externalCustomerId
	);
	const legacyMatches = matches.filter(
		(profile) => !profile.externalCustomerId && hasSameLegacyIdentity(profile, payload)
	);

	const eligibleMatches = exactMatches.length ? [...exactMatches, ...legacyMatches] : legacyMatches;
	const keeper = pickKeeper(eligibleMatches);

	let mergedDuplicates = 0;

	if (!keeper) {
		const created = await prisma.customerProfile.create({
			data: {
				...payload,
				orderCount: 0,
				paidOrderCount: 0,
				distinctProductsCount: 0,
				totalUnitsPurchased: 0,
			},
		});

		return {
			profile: created,
			created: true,
			mergedDuplicates,
		};
	}

	const duplicatesToMerge = eligibleMatches
		.filter((profile) => profile.id !== keeper.id)
		.map((profile) => profile.id);

	if (duplicatesToMerge.length) {
		mergedDuplicates = await mergeProfilesIntoKeeper(keeper.id, duplicatesToMerge);
	}

	const updated = await prisma.customerProfile.update({
		where: { id: keeper.id },
		data: {
			externalCustomerId: pick(keeper.externalCustomerId, payload.externalCustomerId),
			displayName: payload.displayName,
			email: payload.email,
			normalizedEmail: payload.normalizedEmail,
			phone: payload.phone,
			normalizedPhone: payload.normalizedPhone,
			identification: payload.identification,
			note: payload.note,
			acceptsMarketing: payload.acceptsMarketing,
			acceptsMarketingUpdatedAt: payload.acceptsMarketingUpdatedAt,
			defaultAddress: payload.defaultAddress,
			addresses: payload.addresses,
			billingAddress: payload.billingAddress,
			billingNumber: payload.billingNumber,
			billingFloor: payload.billingFloor,
			billingLocality: payload.billingLocality,
			billingZipcode: payload.billingZipcode,
			billingCity: payload.billingCity,
			billingProvince: payload.billingProvince,
			billingCountry: payload.billingCountry,
			billingPhone: payload.billingPhone,
			totalSpent: payload.totalSpent,
			currency: payload.currency,
			lastOrderId: payload.lastOrderId,
			rawCustomerPayload: payload.rawCustomerPayload,
			syncedAt: new Date(),
		},
	});

	return {
		profile: updated,
		created: false,
		mergedDuplicates,
	};
}

async function repairCustomerProfiles(storeId) {
	let mergedDuplicates = 0;

	const profilesByExternal = await prisma.customerProfile.findMany({
		where: { storeId, externalCustomerId: { not: null } },
		select: {
			id: true,
			externalCustomerId: true,
			orderCount: true,
			totalSpent: true,
			lastOrderId: true,
			updatedAt: true,
		},
	});

	const externalMap = new Map();
	for (const profile of profilesByExternal) {
		const key = profile.externalCustomerId;
		if (!key) continue;
		if (!externalMap.has(key)) externalMap.set(key, []);
		externalMap.get(key).push(profile);
	}

	for (const group of externalMap.values()) {
		if (group.length < 2) continue;
		const keeper = pickKeeper(group);
		const duplicates = group.filter((profile) => profile.id !== keeper.id).map((profile) => profile.id);
		mergedDuplicates += await mergeProfilesIntoKeeper(keeper.id, duplicates);
	}

	const legacyProfiles = await prisma.customerProfile.findMany({
		where: { storeId, externalCustomerId: null },
		select: {
			id: true,
			normalizedEmail: true,
			normalizedPhone: true,
			orderCount: true,
			totalSpent: true,
			lastOrderId: true,
			updatedAt: true,
		},
	});

	const emailMap = new Map();
	for (const profile of legacyProfiles) {
		if (!profile.normalizedEmail) continue;
		if (!emailMap.has(profile.normalizedEmail)) emailMap.set(profile.normalizedEmail, []);
		emailMap.get(profile.normalizedEmail).push(profile);
	}

	for (const group of emailMap.values()) {
		if (group.length < 2) continue;
		const keeper = pickKeeper(group);
		const duplicates = group.filter((profile) => profile.id !== keeper.id).map((profile) => profile.id);
		mergedDuplicates += await mergeProfilesIntoKeeper(keeper.id, duplicates);
	}

	const phoneOnlyProfiles = await prisma.customerProfile.findMany({
		where: {
			storeId,
			externalCustomerId: null,
			normalizedEmail: null,
			normalizedPhone: { not: null },
		},
		select: {
			id: true,
			normalizedPhone: true,
			orderCount: true,
			totalSpent: true,
			lastOrderId: true,
			updatedAt: true,
		},
	});

	const phoneMap = new Map();
	for (const profile of phoneOnlyProfiles) {
		if (!profile.normalizedPhone) continue;
		if (!phoneMap.has(profile.normalizedPhone)) phoneMap.set(profile.normalizedPhone, []);
		phoneMap.get(profile.normalizedPhone).push(profile);
	}

	for (const group of phoneMap.values()) {
		if (group.length < 2) continue;
		const keeper = pickKeeper(group);
		const duplicates = group.filter((profile) => profile.id !== keeper.id).map((profile) => profile.id);
		mergedDuplicates += await mergeProfilesIntoKeeper(keeper.id, duplicates);
	}

	return { mergedDuplicates };
}

export async function syncCustomers({ q = '', runRepair = true } = {}) {
	const { storeId, accessToken } = await resolveStoreCredentials();
	const syncLog = await acquireSyncLock(storeId);

	let pagesFetched = 0;
	let customersFetched = 0;
	let customersUpserted = 0;
	let customersCreated = 0;
	let customersUpdated = 0;
	let mergedDuplicates = 0;

	try {
		if (runRepair) {
			const repairResult = await repairCustomerProfiles(storeId);
			mergedDuplicates += repairResult.mergedDuplicates;
		}

		for (let page = 1; page <= MAX_PAGES; page += 1) {
			const customers = await fetchCustomersPage({
				storeId,
				accessToken,
				page,
				q,
			});

			if (!customers.length) break;

			pagesFetched += 1;
			customersFetched += customers.length;

			for (const customer of customers) {
				const payload = buildCustomerProfilePayload(customer, storeId);
				const result = await upsertCustomerProfile(payload);
				customersUpserted += 1;
				mergedDuplicates += result.mergedDuplicates;

				if (result.created) customersCreated += 1;
				else customersUpdated += 1;
			}

			if (customers.length < CUSTOMERS_PER_PAGE) break;
		}

		await finalizeSyncLog(syncLog.id, {
			status: 'SUCCESS',
			pagesFetched,
			ordersFetched: customersFetched,
			ordersUpserted: 0,
			customersTouched: customersUpserted,
			message: `Sync rápida completada. Clientes leídos: ${customersFetched}. Actualizados: ${customersUpdated}. Creados: ${customersCreated}. Duplicados fusionados: ${mergedDuplicates}.`,
		});

		return {
			ok: true,
			storeId,
			pagesFetched,
			customersFetched,
			customersUpserted,
			customersCreated,
			customersUpdated,
			mergedDuplicates,
			customersTouched: customersUpserted,
			ordersUpserted: 0,
		};
	} catch (error) {
		await finalizeSyncLog(syncLog.id, {
			status: 'FAILED',
			pagesFetched,
			ordersFetched: customersFetched,
			ordersUpserted: 0,
			customersTouched: customersUpserted,
			message: error.message || 'Error en sync rápida de clientes.',
		});

		throw error;
	}
}

export async function repairCustomers() {
	const { storeId } = await resolveStoreCredentials();
	const repairResult = await repairCustomerProfiles(storeId);

	return {
		ok: true,
		storeId,
		mergedDuplicates: repairResult.mergedDuplicates,
	};
}
