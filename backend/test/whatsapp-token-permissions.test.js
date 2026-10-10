import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import {
	getWhatsAppWabaSubscription,
	subscribeWhatsAppWaba,
	validateWhatsAppChannelAccess,
} from '../src/services/whatsapp/whatsapp-embedded-signup.service.js';

const baseInput = {
	wabaId: 'waba-test',
	phoneNumberId: 'phone-test',
	accessToken: 'token-test',
	graphVersion: 'v25.0',
	appConfig: { metaAppId: 'app-test', appSecret: 'secret-test' },
};

describe('WhatsApp channel token permission validation', () => {
	it('rejects expired tokens before saving the channel', async (t) => {
		t.mock.method(axios, 'get', async () => ({ data: { data: { is_valid: false, scopes: [] } } }));

		await assert.rejects(
			validateWhatsAppChannelAccess(baseInput),
			(error) => error.code === 'WHATSAPP_TOKEN_INVALID' && error.status === 401
		);
	});

	it('rejects tokens that can read the WABA but cannot send messages', async (t) => {
		t.mock.method(axios, 'get', async () => ({
			data: { data: { is_valid: true, scopes: ['whatsapp_business_management'] } },
		}));

		await assert.rejects(
			validateWhatsAppChannelAccess(baseInput),
			(error) => error.code === 'WHATSAPP_MESSAGING_PERMISSION_MISSING' && error.status === 403
		);
	});

	it('rejects a token created for a different Meta App', async (t) => {
		t.mock.method(axios, 'get', async () => ({
			data: { data: { is_valid: true, app_id: 'another-app', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } },
		}));
		await assert.rejects(
			validateWhatsAppChannelAccess(baseInput),
			(error) => error.code === 'WHATSAPP_TOKEN_APP_MISMATCH' && error.status === 403
		);
	});

	it('rejects a token without WABA management permission', async (t) => {
		t.mock.method(axios, 'get', async () => ({
			data: { data: { is_valid: true, app_id: 'app-test', scopes: ['whatsapp_business_messaging'] } },
		}));
		await assert.rejects(
			validateWhatsAppChannelAccess(baseInput),
			(error) => error.code === 'WHATSAPP_MANAGEMENT_PERMISSION_MISSING' && error.status === 403
		);
	});

	it('accepts a token with messaging permission and validates the requested number', async (t) => {
		t.mock.method(axios, 'get', async (url) => {
			if (url.endsWith('/debug_token')) {
				return {
					data: {
						data: {
							is_valid: true,
							scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
						},
					},
				};
			}
			if (url.endsWith('/waba-test')) return { data: { id: 'waba-test' } };
			if (url.endsWith('/waba-test/phone_numbers')) {
				return { data: { data: [{ id: 'phone-test', display_phone_number: '+5491100000000' }] } };
			}
			throw new Error(`Unexpected Graph request: ${url}`);
		});

		const result = await validateWhatsAppChannelAccess(baseInput);
		assert.equal(result.phoneNumber.id, 'phone-test');
		assert.equal(result.messagingPermissionCheck.checked, true);
		assert.deepEqual(result.messagingPermissionCheck.missingScopes, []);
	});

	it('does not link a number that is absent from the selected WABA', async (t) => {
		t.mock.method(axios, 'get', async (url) => {
			if (url.endsWith('/debug_token')) return { data: { data: { is_valid: true, scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } } };
			if (url.endsWith('/waba-test')) return { data: { id: 'waba-test' } };
			if (url.endsWith('/waba-test/phone_numbers')) return { data: { data: [{ id: 'another-phone' }] } };
			throw new Error(`Unexpected Graph request: ${url}`);
		});
		await assert.rejects(
			validateWhatsAppChannelAccess(baseInput),
			(error) => error.status === 400 && /no aparece entre los números/.test(error.message)
		);
	});

	it('checks the selected App subscription and sends tokens in headers', async (t) => {
		t.mock.method(axios, 'get', async (_url, options) => {
			assert.equal(options.headers.Authorization, 'Bearer token-test');
			assert.equal(options.params?.access_token, undefined);
			return { data: { data: [{ id: 'app-test' }] } };
		});
		const subscription = await getWhatsAppWabaSubscription({
			wabaId: 'waba-test', accessToken: 'token-test', metaAppId: 'app-test', graphVersion: 'v25.0',
		});
		assert.deepEqual(subscription, { checked: true, subscribed: true });
	});

	it('subscribes the App to WABA webhooks before activation', async (t) => {
		t.mock.method(axios, 'post', async (_url, _body, options) => {
			assert.equal(options.headers.Authorization, 'Bearer token-test');
			return { data: { success: true } };
		});
		const subscription = await subscribeWhatsAppWaba({ wabaId: 'waba-test', accessToken: 'token-test' });
		assert.deepEqual(subscription, { success: true });
	});
});
