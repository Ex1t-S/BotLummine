import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from '@aws-sdk/client-s3';

function normalize(value = '') {
	return String(value ?? '').trim();
}

function normalizeBoolean(value, fallback = false) {
	const normalized = normalize(value).toLowerCase();
	if (!normalized) return fallback;
	return ['1', 'true', 'yes', 'on', 'enabled', 'r2'].includes(normalized);
}

function readConfig(env = process.env) {
	const accountId = normalize(env.R2_ACCOUNT_ID);
	const endpoint = normalize(env.R2_ENDPOINT) || (accountId
		? `https://${accountId}.r2.cloudflarestorage.com`
		: '');

	return {
		enabled: normalizeBoolean(env.OBJECT_STORAGE_ENABLED || env.OBJECT_STORAGE_MODE),
		endpoint,
		accessKeyId: normalize(env.R2_ACCESS_KEY_ID),
		secretAccessKey: normalize(env.R2_SECRET_ACCESS_KEY),
		privateBucket: normalize(env.R2_PRIVATE_BUCKET),
		publicBucket: normalize(env.R2_PUBLIC_BUCKET),
		publicBaseUrl: normalize(env.R2_PUBLIC_BASE_URL).replace(/\/+$/, ''),
	};
}

export function inspectR2StorageConfig(env = process.env) {
	const config = readConfig(env);
	const missing = [];

	if (config.enabled) {
		if (!config.endpoint) missing.push('R2_ACCOUNT_ID o R2_ENDPOINT');
		if (!config.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
		if (!config.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
		if (!config.privateBucket) missing.push('R2_PRIVATE_BUCKET');
		if (!config.publicBucket) missing.push('R2_PUBLIC_BUCKET');
		if (!config.publicBaseUrl) missing.push('R2_PUBLIC_BASE_URL');
	}

	return {
		enabled: config.enabled,
		configured: config.enabled && missing.length === 0,
		missing,
		privateBucket: config.privateBucket,
		publicBucket: config.publicBucket,
		publicBaseUrl: config.publicBaseUrl,
	};
}

export function assertR2StorageConfig(env = process.env) {
	const inspected = inspectR2StorageConfig(env);
	if (inspected.enabled && !inspected.configured) {
		const error = new Error(`R2 habilitado pero incompleto: ${inspected.missing.join(', ')}`);
		error.code = 'R2_STORAGE_CONFIG_INVALID';
		throw error;
	}
	return inspected;
}

let cachedClient = null;
let cachedFingerprint = '';

function getClientAndConfig() {
	assertR2StorageConfig();
	const config = readConfig();
	if (!config.enabled) {
		const error = new Error('El almacenamiento R2 no está habilitado.');
		error.code = 'R2_STORAGE_DISABLED';
		throw error;
	}

	const fingerprint = [config.endpoint, config.accessKeyId].join('|');
	if (!cachedClient || cachedFingerprint !== fingerprint) {
		cachedClient = new S3Client({
			region: 'auto',
			endpoint: config.endpoint,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
		});
		cachedFingerprint = fingerprint;
	}

	return { client: cachedClient, config };
}

function normalizeObjectKey(value = '') {
	const key = normalize(value).replace(/^\/+/, '');
	if (!key || key.includes('..') || key.includes('\\')) {
		const error = new Error('Clave de almacenamiento inválida.');
		error.code = 'R2_STORAGE_KEY_INVALID';
		throw error;
	}
	return key;
}

async function putObject({ bucket, key, body, contentType, cacheControl, metadata }) {
	const { client } = getClientAndConfig();
	const objectKey = normalizeObjectKey(key);
	await client.send(new PutObjectCommand({
		Bucket: bucket,
		Key: objectKey,
		Body: body,
		ContentType: normalize(contentType) || 'application/octet-stream',
		CacheControl: normalize(cacheControl) || undefined,
		Metadata: metadata || undefined,
	}));
	return { key: objectKey, bucket };
}

export function isR2StorageEnabled() {
	return inspectR2StorageConfig().configured;
}

export async function putPrivateObject({ key, body, contentType, metadata }) {
	const { config } = getClientAndConfig();
	return putObject({
		bucket: config.privateBucket,
		key,
		body,
		contentType,
		cacheControl: 'private, no-store',
		metadata,
	});
}

export async function putPublicObject({ key, body, contentType, metadata }) {
	const { config } = getClientAndConfig();
	const stored = await putObject({
		bucket: config.publicBucket,
		key,
		body,
		contentType,
		cacheControl: 'public, max-age=31536000, immutable',
		metadata,
	});
	return {
		...stored,
		url: `${config.publicBaseUrl}/${encodeURI(stored.key)}`,
	};
}

export async function getPrivateObject(key) {
	const { client, config } = getClientAndConfig();
	return client.send(new GetObjectCommand({
		Bucket: config.privateBucket,
		Key: normalizeObjectKey(key),
	}));
}

export async function headPrivateObject(key) {
	const { client, config } = getClientAndConfig();
	return client.send(new HeadObjectCommand({
		Bucket: config.privateBucket,
		Key: normalizeObjectKey(key),
	}));
}

