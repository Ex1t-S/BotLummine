import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import { validateWhatsAppAppWebhook } from '../src/services/whatsapp/whatsapp-embedded-signup.service.js';

const input = { metaAppId: '123', appSecret: 'test-secret', callbackUrl: 'https://api.example.com/api/webhook/whatsapp/test-key', graphVersion: 'v25.0' };
const subscription = { object: 'whatsapp_business_account', active: true, callback_url: input.callbackUrl, fields: [{ name: 'messages', version: 'v25.0' }] };

describe('manual WhatsApp connection webhook validation', () => {
	it('accepts the active messages webhook and keeps the app credential out of query parameters', async (t) => {
		t.mock.method(axios, 'get', async (url, options) => {
			assert.equal(url, 'https://graph.facebook.com/v25.0/123/subscriptions');
			assert.equal(options.headers.Authorization, 'Bearer 123|test-secret');
			assert.equal(options.params.access_token, undefined);
			return { data: { data: [subscription] } };
		});
		assert.deepEqual(await validateWhatsAppAppWebhook(input), { checked: true, configured: true });
	});
	for (const [name, value] of [
		['a different callback', { ...subscription, callback_url: 'https://another.example.com/webhook' }],
		['an inactive subscription', { ...subscription, active: false }],
		['missing messages events', { ...subscription, fields: [{ name: 'account_update' }] }],
		['a different product', { ...subscription, object: 'page' }],
	]) {
		it(`blocks activation with ${name}`, async (t) => {
			t.mock.method(axios, 'get', async () => ({ data: { data: [value] } }));
			await assert.rejects(validateWhatsAppAppWebhook(input), (error) => error.code === 'WHATSAPP_WEBHOOK_NOT_CONFIGURED');
		});
	}
	it('blocks a missing webhook and propagates a Meta access error without claiming success', async (t) => {
		t.mock.method(axios, 'get', async () => ({ data: { data: [] } }));
		await assert.rejects(validateWhatsAppAppWebhook(input), /messages/);
		axios.get.mock.mockImplementation(async () => { throw { response: { status: 403, data: { error: { code: 190, message: 'Invalid app credential' } } } }; });
		await assert.rejects(validateWhatsAppAppWebhook(input), (error) => error.metaCode === 190 && !error.message.includes('test-secret'));
	});
});
