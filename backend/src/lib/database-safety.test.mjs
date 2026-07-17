import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertSafeDatabaseTarget, inspectDatabaseTarget } from './database-safety.js';

describe('database target safety', () => {
	it('allows local PostgreSQL without an override', () => {
		const result = assertSafeDatabaseTarget({
			DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/bot_test',
		});

		assert.equal(result.isLocal, true);
	});

	it('blocks a remote database during local development', () => {
		assert.throws(
			() => assertSafeDatabaseTarget({ DATABASE_URL: 'postgresql://user:password@db.example.test/app' }),
			(error) => error?.code === 'UNSAFE_REMOTE_DATABASE_TARGET'
		);
	});

	it('allows a remote target inside Railway without exposing the URL', () => {
		const result = assertSafeDatabaseTarget({
			DATABASE_URL: 'postgresql://user:password@db.example.test/app',
			RAILWAY_ENVIRONMENT_ID: 'environment-id',
		});

		assert.deepEqual(result, {
			configured: true,
			host: 'db.example.test',
			isLocal: false,
		});
	});

	it('does not include credentials in inspection output', () => {
		const inspected = inspectDatabaseTarget('postgresql://secret-user:secret-password@localhost:5432/app');
		assert.equal(JSON.stringify(inspected).includes('secret'), false);
	});
});
