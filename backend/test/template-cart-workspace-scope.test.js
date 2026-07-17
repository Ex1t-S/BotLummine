import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { filterRecoverableAbandonedCarts } from '../src/services/campaigns/campaign-attribution.service.js';
import { syncAbandonedCarts } from '../src/services/carts/abandoned-cart.service.js';
import {
	createTemplate,
	deleteTemplate,
	getTemplateOrThrow,
	listLocalTemplates,
	purgeDeletedLocalTemplates,
	syncTemplatesFromMeta,
	updateTemplate,
	upsertLocalTemplate,
} from '../src/services/whatsapp/whatsapp-template.service.js';

describe('template and cart workspace boundaries', () => {
	it('rejects template lookup and deletion without an explicit workspace', async () => {
		for (const operation of [
			() => getTemplateOrThrow('template-a'),
			() => deleteTemplate('template-a'),
			() => upsertLocalTemplate({ name: 'template-a' }),
			() => listLocalTemplates(),
			() => syncTemplatesFromMeta(),
			() => purgeDeletedLocalTemplates(),
			() => createTemplate({ name: 'template-a' }),
			() => updateTemplate('template-a'),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});

	it('rejects recoverability checks without an explicit workspace', async () => {
		await assert.rejects(
			() => filterRecoverableAbandonedCarts([{ id: 'cart-a' }]),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('rejects abandoned-cart synchronization without an explicit workspace', async () => {
		await assert.rejects(
			() => syncAbandonedCarts(),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('keeps template sync logs and environmental fallback workspace-scoped', async () => {
		const source = await readFile(
			new URL('../src/services/whatsapp/whatsapp-template.service.js', import.meta.url),
			'utf8',
		);

		assert.doesNotMatch(source, /workspaceId\s*=\s*DEFAULT_WORKSPACE_ID/);
		assert.match(source, /allowEnvironmentFallback\s*=\s*resolvedWorkspaceId\s*===\s*DEFAULT_WORKSPACE_ID/);
		assert.match(source, /WHATSAPP_TEMPLATE_CHANNEL_NOT_CONFIGURED/);
		assert.doesNotMatch(source, /where:\s*\{\s*id:\s*syncLog\.id\s*\}/);
	});
});
