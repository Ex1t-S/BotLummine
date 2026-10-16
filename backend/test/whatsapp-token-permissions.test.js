import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import {
	discoverWhatsAppManualAssets,
	validateMetaAppCredentials,
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
	it('rejects an access token in the App Secret field', async () => {
		await assert.rejects(
			validateMetaAppCredentials({ metaAppId: '123', appSecret: 'EAAexpiredtoken' }),
			(error) => error.status === 400 && /access token/.test(error.message)
		);
	});

	it('checks the App Secret against Meta before it can be saved', async (t) => {
		t.mock.method(axios, 'get', async (url, options) => {
			assert.ok(url.endsWith('/123'));
			assert.equal(options.headers.Authorization, 'Bearer 123|valid-secret');
			return { data: { id: '123', name: 'Marca' } };
		});
		assert.deepEqual(await validateMetaAppCredentials({ metaAppId: '123', appSecret: 'valid-secret', graphVersion: 'v25.0' }), { id: '123', name: 'Marca' });
	});
	it('discovers the business WABA and its real phone number without exposing the token', async (t) => {
		t.mock.method(axios, 'get', async (url, options) => {
			if (url.endsWith('/debug_token')) {
				assert.equal(options.headers.Authorization, 'Bearer app-test|secret-test');
				return { data: { data: { is_valid: true, app_id: 'app-test', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } } };
			}
			assert.equal(options.headers.Authorization, 'Bearer token-test');
			if (url.endsWith('/owned_whatsapp_business_accounts')) return { data: { data: [{ id: '12345', name: 'Marca' }] } };
			if (url.endsWith('/client_whatsapp_business_accounts')) return { data: { data: [] } };
			if (url.endsWith('/12345/phone_numbers')) return { data: { data: [{ id: '98765', display_phone_number: '+54 11 1234-5678', code_verification_status: 'VERIFIED' }] } };
			throw new Error(`Unexpected Graph request: ${url}`);
		});
		const result = await discoverWhatsAppManualAssets({
			accessToken: 'token-test', businessManagerId: '111', graphVersion: 'v25.0',
			appConfig: baseInput.appConfig,
		});
		assert.equal(result.wabas[0].id, '12345');
		assert.equal(result.wabas[0].phoneNumbers[0].id, '98765');
		assert.equal(result.wabas[0].phoneNumbers[0].codeVerificationStatus, 'VERIFIED');
		assert.equal(JSON.stringify(result).includes('token-test'), false);
	});

	it('uses token-scoped WABAs when the business listing is unavailable', async (t) => {
		t.mock.method(axios, 'get', async (url) => {
			if (url.endsWith('/debug_token')) return { data: { data: { is_valid: true, app_id: 'app-test', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'], granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['12345'] }] } } };
			if (url.endsWith('/owned_whatsapp_business_accounts') || url.endsWith('/client_whatsapp_business_accounts')) throw new Error('Unavailable');
			if (url.endsWith('/12345/phone_numbers')) return { data: { data: [{ id: '98765' }] } };
			throw new Error(`Unexpected Graph request: ${url}`);
		});
		const result = await discoverWhatsAppManualAssets({ accessToken: 'token-test', businessManagerId: '111', appConfig: baseInput.appConfig });
		assert.equal(result.wabas[0].phoneNumbers[0].id, '98765');
		assert.equal(result.warnings.length, 2);
	});
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
