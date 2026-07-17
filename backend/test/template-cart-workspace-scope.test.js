import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { filterRecoverableAbandonedCarts } from '../src/services/campaigns/campaign-attribution.service.js';
import {
	deleteTemplate,
	getTemplateOrThrow,
} from '../src/services/whatsapp/whatsapp-template.service.js';

describe('template and cart workspace boundaries', () => {
	it('rejects template lookup and deletion without an explicit workspace', async () => {
		await assert.rejects(
			() => getTemplateOrThrow('template-a'),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
		await assert.rejects(
			() => deleteTemplate('template-a'),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('rejects recoverability checks without an explicit workspace', async () => {
		await assert.rejects(
			() => filterRecoverableAbandonedCarts([{ id: 'cart-a' }]),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});
});
