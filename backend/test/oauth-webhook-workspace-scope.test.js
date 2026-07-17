import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

async function readSource(relativePath) {
	return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

describe('OAuth and commerce webhook workspace boundaries', () => {
	it('requires signed Tiendanube state and authenticated request scope in every environment', async () => {
		const source = await readSource('../src/controllers/tiendanube.controller.js');

		assert.doesNotMatch(source, /NODE_ENV\s*!==\s*['"]production['"][\s\S]*workspaceId:\s*String\(value\)/);
		assert.doesNotMatch(source, /req\.(?:body|query)\?\.workspaceId\s*\|\|\s*DEFAULT_WORKSPACE_ID/);
		assert.match(source, /resolveTiendanubeStateWorkspaceId[\s\S]*requireWorkspaceScope/);
		assert.match(source, /function buildInstallUrl\(workspaceId\)/);
		assert.doesNotMatch(source, /workspaceId\s*=\s*DEFAULT_WORKSPACE_ID/);
		assert.match(source, /if \(workspaceId\) \{\s*url\.searchParams\.set\('workspaceId', workspaceId\)/);
		const callbackStart = source.indexOf('export async function handleTiendanubeCallback');
		const callbackEnd = source.indexOf('export async function registerTiendanubeWebhooks', callbackStart);
		const callbackSource = source.slice(callbackStart, callbackEnd);
		assert.ok(callbackSource);
		assert.doesNotMatch(callbackSource, /const resultUrl = buildTiendanubeInstallResultUrl/);
		assert.doesNotMatch(callbackSource, /return res\.send\(`/);
	});

	it('does not infer Tiendanube webhook credentials when store_id is missing', async () => {
		const source = await readSource('../src/controllers/webhook.controller.js');

		assert.match(source, /store_id es obligatorio para resolver el workspace del webhook/);
		assert.doesNotMatch(source, /return resolveStoreCredentials\(\)/);
	});
});
