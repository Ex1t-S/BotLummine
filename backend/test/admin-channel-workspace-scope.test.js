import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('admin WhatsApp channel workspace boundary', () => {
	it('keeps manual and embedded-signup channel updates scoped through the final write', async () => {
		const source = await readFile(
			new URL('../src/controllers/admin.controller.js', import.meta.url),
			'utf8',
		);

		assert.match(source, /where:\s*workspaceOwnedWhere\(\{ id: channelId, workspaceId \}\)/);
		assert.match(source, /where:\s*workspaceOwnedWhere\(\{ id: existingPhone\.id, workspaceId \}\)/);
		assert.doesNotMatch(source, /whatsAppChannel\.update\(\{\s*where:\s*\{ id: channelId \}/);
		assert.doesNotMatch(source, /whatsAppChannel\.update\(\{\s*where:\s*\{ id: existingPhone\.id \}/);
	});
});
