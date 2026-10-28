import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import { decryptSecret, encryptSecret } from '../src/lib/secret-crypto.js';
const unused = () => assert.fail('Unexpected database operation');
const prisma = {
	whatsAppApp: { findFirst: unused, create: unused, update: unused },
	whatsAppChannel: { findFirst: unused, findUnique: unused, upsert: unused, update: unused, updateMany: unused },
};
globalThis.prisma = prisma;
const { upsertWhatsAppApp, getWhatsAppWebhookCredentials, upsertWhatsAppChannel } = await import('../src/controllers/admin.controller.js');

function env(t, key, value) {
	const previous = process.env[key];
	process.env[key] = value;
	t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

const workspaceId = 'workspace-setup-test';
const request = (body = {}, params = {}) => ({ body, params: { workspaceId, ...params }, user: { role: 'ADMIN', workspaceId } });
function response() {
	return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(key, value) { this.headers[key] = value; return this; }, json(body) { this.body = body; return this; } };
}
const next = (error) => { throw error; };

describe('manual WhatsApp setup', () => {
	it('generates and encrypts a new verify token without requiring Embedded Signup', async (t) => {
		env(t, 'SECRET_ENCRYPTION_KEY', 'test-encryption-key-'.repeat(5));
		env(t, 'BACKEND_PUBLIC_URL', 'https://api.example.com');
		t.mock.method(prisma.whatsAppApp, 'findFirst', async () => null);
		t.mock.method(prisma.whatsAppApp, 'create', async ({ data }) => {
			assert.match(data.verifyToken, /^enc:v1:/);
			assert.match(data.appSecret, /^enc:v1:/);
			assert.equal(data.embeddedSignupConfigId, '');
			return { id: 'app-local', ...data };
		});
		const res = response();
		await upsertWhatsAppApp(request({ metaAppId: '123', appSecret: 'secret-test' }), res, next);
		assert.match(res.body.webhook.verifyToken, /^[A-Za-z0-9_-]{32}$/);
		assert.ok(res.body.webhook.callbackUrl.startsWith('https://api.example.com/api/webhook/whatsapp/'));
		assert.equal(res.body.app.verifyToken, undefined);
		assert.equal(res.body.app.appSecret, undefined);
		assert.equal(res.headers['Cache-Control'], 'no-store');
	});
	it('preserves existing callback and verify token when saving other app data', async (t) => {
		const app = { id: 'app-local', workspaceId, callbackKey: 'existing-callback', metaAppId: '123', appSecret: encryptSecret('original-secret'), verifyToken: encryptSecret('original-token'), status: 'ACTIVE' };
		t.mock.method(prisma.whatsAppApp, 'findFirst', async ({ where }) => where.id === app.id ? app : null);
		t.mock.method(prisma.whatsAppApp, 'update', async ({ data }) => ({ ...app, ...data }));
		const res = response();
		await upsertWhatsAppApp(request({ metaAppId: '123', name: 'Updated' }, { appId: app.id }), res, next);
		assert.equal(res.body.app.callbackKey, 'existing-callback');
		assert.equal(res.body.webhook.verifyToken, 'original-token');
	});
	it('scopes retrieval of the verify token to the authenticated workspace', async (t) => {
		t.mock.method(prisma.whatsAppApp, 'findFirst', async ({ where }) => {
			assert.deepEqual(where, { id: 'other-workspace-app', workspaceId });
			return null;
		});
		const res = response();
		await getWhatsAppWebhookCredentials(request({}, { appId: 'other-workspace-app', workspaceId: 'other-workspace' }), res, next);
		assert.equal(res.statusCode, 404);
		assert.equal(res.body.webhook, undefined);
	});
	it('does not expose a verify token to inbox agents', async () => {
		const req = request({}, { appId: 'app-local' });
		req.user.role = 'AGENT';
		await assert.rejects(getWhatsAppWebhookCredentials(req, response(), next), (error) => error.status === 403);
	});
	for (const ready of [false, true]) {
		it(ready ? 'validates and subscribes in one call before saving the active channel' : 'does not subscribe or save a channel when messages webhook is missing', async (t) => {
			env(t, 'BACKEND_PUBLIC_URL', 'https://api.example.com');
			const app = { id: 'app-local', workspaceId, metaAppId: '123', callbackKey: 'callback-test', appSecret: encryptSecret('test-secret'), graphVersion: 'v25.0' };
			t.mock.method(prisma.whatsAppApp, 'findFirst', async () => app);
			t.mock.method(prisma.whatsAppChannel, 'findUnique', async () => null);
			let subscribed = false;
			t.mock.method(axios, 'get', async (url) => {
				if (url.endsWith('/debug_token')) return { data: { data: { is_valid: true, app_id: '123', scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'] } } };
				if (url.endsWith('/456')) return { data: { id: '456' } };
				if (url.endsWith('/456/phone_numbers')) return { data: { data: [{ id: '789', status: 'CONNECTED', platform_type: 'CLOUD_API', display_phone_number: '+5491100000000' }] } };
				if (url.endsWith('/123/subscriptions')) return { data: { data: ready ? [{ object: 'whatsapp_business_account', active: true, callback_url: 'https://api.example.com/api/webhook/whatsapp/callback-test', fields: [{ name: 'messages' }] }] : [] } };
				if (url.endsWith('/456/subscribed_apps')) { assert.equal(subscribed, true); return { data: { data: [{ id: '123' }] } }; }
				throw new Error(`Unexpected request: ${url}`);
			});
			const post = t.mock.method(axios, 'post', async () => { subscribed = true; return { data: { success: true } }; });
			const save = t.mock.method(prisma.whatsAppChannel, 'upsert', async ({ create }) => {
				assert.equal(subscribed, true);
				assert.equal(decryptSecret(create.accessToken), 'test-user-token');
				return { id: 'channel-local', ...create };
			});
			const res = response();
			await upsertWhatsAppChannel(request({ whatsappAppId: app.id, wabaId: '456', phoneNumberId: '789', accessToken: 'test-user-token', status: 'ACTIVE' }), res, next);
			assert.equal(res.statusCode, ready ? 200 : 400);
			assert.equal(save.mock.callCount(), ready ? 1 : 0);
			assert.equal(post.mock.callCount(), ready ? 1 : 0);
			if (ready) assert.equal(res.body.webhook.configured, true);
		});
	}
});
