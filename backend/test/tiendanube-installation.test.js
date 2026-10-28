import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { saveTiendanubeInstallation } from '../src/services/tiendanube/installation.service.js';
import { decryptSecret } from '../src/lib/secret-crypto.js';
import { startTiendanubeInstall } from '../src/controllers/tiendanube.controller.js';

function setEnv(t, key, value) {
	const previous = process.env[key];
	process.env[key] = value;
	t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}
const input = { workspaceId: 'pampa-test', data: { user_id: '5326130', access_token: 'test-token', scope: 'read_orders,read_products' } };
function database({ installation = null, connections = [] } = {}) {
	const writes = [];
	const tx = {
		storeInstallation: { findUnique: async () => installation, upsert: async (args) => { writes.push(args); return args.create; } },
		commerceConnection: { findMany: async () => connections, upsert: async (args) => { writes.push(args); return { id: 'connection-test', ...args.create }; } },
	};
	return { writes, client: { $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(tx); } } };
}

describe('Tiendanube installation', () => {
	it('uses the registered provider callback and scopes and sends only signed state', async (t) => {
		setEnv(t, 'TIENDANUBE_APP_ID', '28422');
		setEnv(t, 'TIENDANUBE_REDIRECT_URI', 'https://api.example.com/api/tiendanube/callback');
		setEnv(t, 'TIENDANUBE_STATE_SECRET', 'test-state-secret');
		let location;
		await startTiendanubeInstall({ user: { role: 'ADMIN', workspaceId: 'pampa-test' } }, { redirect(url) { location = url; } });
		const url = new URL(location);
		assert.equal(url.origin + url.pathname, 'https://www.tiendanube.com/apps/28422/authorize');
		assert.deepEqual([...url.searchParams.keys()], ['state']);
		const state = url.searchParams.get('state');
		assert.equal(state.split('.').length, 2);
		assert.equal(JSON.parse(Buffer.from(state.split('.')[0], 'base64url')).workspaceId, 'pampa-test');
	});
	it('saves a new authorized store and its encrypted credentials in one transaction', async () => {
		const db = database();
		const connection = await saveTiendanubeInstallation(input, { prismaClient: db.client });
		assert.equal(connection.workspaceId, input.workspaceId);
		assert.equal(connection.externalStoreId, '5326130');
		assert.equal(decryptSecret(connection.accessToken), 'test-token');
		assert.equal(db.writes.length, 2);
	});
	for (const [name, state] of [
		['installation owned by another workspace', { installation: { workspaceId: 'lummine-test' } }],
		['commerce connection owned by another workspace', { connections: [{ workspaceId: 'lummine-test', externalStoreId: '5326130' }] }],
		['different store already connected to this workspace', { connections: [{ workspaceId: 'pampa-test', externalStoreId: '999' }] }],
	]) {
		it(`rejects ${name} before writing either record`, async () => {
			const db = database(state);
			await assert.rejects(saveTiendanubeInstallation(input, { prismaClient: db.client }), (error) => error.code === 'TIENDANUBE_STORE_WORKSPACE_CONFLICT');
			assert.equal(db.writes.length, 0);
		});
	}
	it('allows reconnecting the same store to the same workspace', async () => {
		const db = database({ installation: { workspaceId: 'pampa-test' }, connections: [{ workspaceId: 'pampa-test', externalStoreId: '5326130' }] });
		await saveTiendanubeInstallation(input, { prismaClient: db.client });
		assert.equal(db.writes.length, 2);
	});
	it('also protects the legacy environment connection', async (t) => {
		setEnv(t, 'TIENDANUBE_STORE_ID', '5326130');
		setEnv(t, 'DEFAULT_WORKSPACE_ID', 'lummine-test');
		const db = database();
		await assert.rejects(saveTiendanubeInstallation(input, { prismaClient: db.client }), /otra marca/);
		assert.equal(db.writes.length, 0);
	});
});
