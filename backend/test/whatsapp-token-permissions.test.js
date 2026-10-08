import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import { validateWhatsAppChannelAccess } from '../src/services/whatsapp/whatsapp-embedded-signup.service.js';

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
		assert.deepEqual(result.messagingPermissionCheck, { checked: true, missingScopes: [] });
	});
});
