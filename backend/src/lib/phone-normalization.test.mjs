import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeWhatsAppIdentityPhone } from './phone-normalization.js';

describe('normalizeWhatsAppIdentityPhone', () => {
	it('keeps already normalized Argentine mobile numbers', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('5491112345678'), '5491112345678');
		assert.equal(normalizeWhatsAppIdentityPhone('+54 9 221 512-3456'), '5492215123456');
	});

	it('adds the Argentine mobile 9 for national numbers', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('11 1234-5678'), '5491112345678');
		assert.equal(normalizeWhatsAppIdentityPhone('0221 512-3456'), '5492215123456');
	});

	it('removes domestic mobile 15 only when the national number has domestic mobile length', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('011 15 1234-5678'), '5491112345678');
		assert.equal(normalizeWhatsAppIdentityPhone('0221 15 123-4567'), '5492211234567');
		assert.equal(normalizeWhatsAppIdentityPhone('0341 15 123-4567'), '5493411234567');
	});

	it('does not strip a false 15 when area code ends in 1 and local number starts with 5', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('0221 512-3456'), '5492215123456');
		assert.equal(normalizeWhatsAppIdentityPhone('0341 512-3456'), '5493415123456');
	});

	it('rejects malformed Argentine numbers instead of producing short WhatsApp ids', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('549225123456'), '');
		assert.equal(normalizeWhatsAppIdentityPhone('54918555447'), '');
		assert.equal(normalizeWhatsAppIdentityPhone('225123456'), '');
	});

	it('keeps valid non-Argentine international numbers', () => {
		assert.equal(normalizeWhatsAppIdentityPhone('+1 650 555 0123'), '16505550123');
		assert.equal(normalizeWhatsAppIdentityPhone('0057 300 123 4567'), '573001234567');
		assert.equal(normalizeWhatsAppIdentityPhone('573001234567'), '573001234567');
	});
});
