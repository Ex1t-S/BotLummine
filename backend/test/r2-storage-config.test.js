import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertR2StorageConfig,
	inspectR2StorageConfig,
} from '../src/services/storage/r2-storage.service.js';

test('R2 remains optional when object storage is disabled', () => {
	assert.deepEqual(inspectR2StorageConfig({}), {
		enabled: false,
		configured: false,
		missing: [],
		privateBucket: '',
		publicBucket: '',
		publicBaseUrl: '',
	});
});

test('R2 validates every production credential when enabled', () => {
	assert.throws(
		() => assertR2StorageConfig({ OBJECT_STORAGE_ENABLED: 'true' }),
		(error) => error.code === 'R2_STORAGE_CONFIG_INVALID' && error.message.includes('R2_ACCESS_KEY_ID')
	);
});

test('R2 accepts an account-scoped S3 configuration', () => {
	const result = assertR2StorageConfig({
		OBJECT_STORAGE_MODE: 'r2',
		R2_ACCOUNT_ID: 'account-id',
		R2_ACCESS_KEY_ID: 'access-key',
		R2_SECRET_ACCESS_KEY: 'secret-key',
		R2_PRIVATE_BUCKET: 'bladeia-private-prod',
		R2_PUBLIC_BUCKET: 'bladeia',
		R2_PUBLIC_BASE_URL: 'https://assets.bladeia.com/',
	});

	assert.equal(result.configured, true);
	assert.equal(result.publicBaseUrl, 'https://assets.bladeia.com');
});
