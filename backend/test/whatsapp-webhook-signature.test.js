import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
	getWhatsAppWebhookSecrets,
	verifyWhatsAppWebhookSignature
} from '../src/lib/whatsapp-webhook-signature.js';

const payload = Buffer.from('{"object":"whatsapp_business_account"}');

function signatureFor(secret) {
	return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

describe('WhatsApp webhook signature validation', () => {
	it('keeps the legacy single secret configuration compatible', () => {
		const env = { META_APP_SECRET: 'legacy-secret' };
		assert.deepEqual(getWhatsAppWebhookSecrets(env), ['legacy-secret']);
		assert.equal(verifyWhatsAppWebhookSignature(payload, signatureFor('legacy-secret'), env), true);
	});

	it('accepts webhooks signed by either configured app during a transition', () => {
		const env = {
			META_APP_SECRET: 'primary-secret',
			WHATSAPP_APP_SECRETS: 'primary-secret, temporary-client-app-secret'
		};

		assert.deepEqual(getWhatsAppWebhookSecrets(env), [
			'primary-secret',
			'temporary-client-app-secret'
		]);
		assert.equal(verifyWhatsAppWebhookSignature(payload, signatureFor('primary-secret'), env), true);
		assert.equal(
			verifyWhatsAppWebhookSignature(payload, signatureFor('temporary-client-app-secret'), env),
			true
		);
	});

	it('rejects invalid, unsigned, and malformed signatures', () => {
		const env = { WHATSAPP_APP_SECRETS: 'primary-secret,temporary-client-app-secret' };
		assert.equal(verifyWhatsAppWebhookSignature(payload, signatureFor('other-secret'), env), false);
		assert.equal(verifyWhatsAppWebhookSignature(payload, '', env), false);
		assert.equal(verifyWhatsAppWebhookSignature(payload, 'sha256=not-a-signature', env), false);
	});
});
