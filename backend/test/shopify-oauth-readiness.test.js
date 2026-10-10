import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

async function readSource(relativePath) {
	return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Shopify OAuth installation and first sync', () => {
	it('starts the authorization-code flow with a signed, workspace-bound state', async () => {
		const source = await readSource('../src/controllers/shopify.controller.js');

		assert.match(source, /signState\(\{\s*workspaceId,\s*shopDomain,\s*ts:\s*Date\.now\(\),\s*nonce:/);
		assert.match(source, /\/admin\/oauth\/authorize/);
		assert.match(source, /url\.searchParams\.set\('redirect_uri',\s*getRedirectUri\(req\)\)/);
		assert.match(source, /url\.searchParams\.set\('scope',\s*getScopes\(\)\)/);
	});

	it('validates callback HMAC and state before exchanging the code or assigning the store', async () => {
		const source = await readSource('../src/controllers/shopify.controller.js');
		const callbackStart = source.indexOf('export async function handleShopifyCallback');
		const callbackEnd = source.indexOf('export async function getShopifyStatus', callbackStart);
		const callback = source.slice(callbackStart, callbackEnd);

		assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
		assert.ok(callback.indexOf('verifyState(state)') < callback.indexOf('verifyShopifyQueryHmac(req.query)'));
		assert.ok(callback.indexOf('verifyShopifyQueryHmac(req.query)') < callback.indexOf('/admin/oauth/access_token'));
		assert.match(callback, /statePayload\.shopDomain[\s\S]*shopDomain/);
		assert.match(callback, /provider_externalStoreId:[\s\S]*provider:\s*'SHOPIFY'/);
		assert.match(callback, /accessToken:\s*encryptedAccessToken/);
	});

	it('starts initial catalog and customer/order synchronization after storing the connection', async () => {
		const source = await readSource('../src/controllers/shopify.controller.js');
		const callbackStart = source.indexOf('export async function handleShopifyCallback');
		const callbackEnd = source.indexOf('export async function getShopifyStatus', callbackStart);
		const callback = source.slice(callbackStart, callbackEnd);

		assert.ok(callback.indexOf('await markPrimaryCommerceConnection') < callback.indexOf('await syncCatalogFromShopify'));
		assert.match(callback, /syncCustomers\(\{\s*workspaceId,\s*provider:\s*'SHOPIFY'/);
		assert.match(callback, /registerShopifyWebhooks/);
	});

	it('avoids duplicating webhooks when the same callback subscriptions already exist', async () => {
		const source = await readSource('../src/controllers/shopify.controller.js');

		assert.match(source, /listShopifyWebhooks\(shopDomain, accessToken\)/);
		assert.match(source, /existingTopics\.has\(topic\)/);
		assert.match(source, /webhook\.address === address/);
	});

	it('allows read_all_orders to be explicitly requested after Shopify grants access', async () => {
		const source = await readSource('../src/controllers/shopify.controller.js');

		assert.match(source, /'read_all_orders'/);
		assert.match(source, /SHOPIFY_APP_SCOPES \|\| SHOPIFY_DEFAULT_SCOPES/);
	});
});
