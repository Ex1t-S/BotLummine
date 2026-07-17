import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
	AUTOMATION_SCHEMA_ERROR_CODE,
	createAutomationSchemaNotReadyError,
} from './automation-schema-error.js';

const AUTOMATION_SERVICE_FILES = [
	'pending-payment-automation.service.js',
	'abandoned-cart-automation.service.js',
	'shipment-notification.service.js',
];

describe('automation schema safety', () => {
	it('returns an actionable unavailable error without exposing the database failure', () => {
		const cause = new Error('postgres://user:secret@example.invalid/database');
		const error = createAutomationSchemaNotReadyError('de prueba', cause);

		assert.equal(error.code, AUTOMATION_SCHEMA_ERROR_CODE);
		assert.equal(error.statusCode, 503);
		assert.equal(error.cause, cause);
		assert.match(error.message, /faltan migraciones/i);
		assert.doesNotMatch(error.message, /secret|postgres/i);
	});

	it('keeps schema DDL out of request and job runtime services', () => {
		for (const fileName of AUTOMATION_SERVICE_FILES) {
			const source = readFileSync(new URL(fileName, import.meta.url), 'utf8');

			assert.doesNotMatch(source, /\$executeRawUnsafe/, fileName);
			assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i, fileName);
			assert.match(source, /createAutomationSchemaNotReadyError/, fileName);
		}
	});
});
