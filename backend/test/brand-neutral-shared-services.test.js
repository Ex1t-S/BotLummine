import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

async function readSource(relativePath) {
	return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

describe('shared brand neutrality', () => {
	it('does not identify workspace analysis as BotLummine', async () => {
		const source = await readSource('../src/services/workspaces/workspace-context-draft.service.js');

		assert.doesNotMatch(source, /BotLummine Context Analyzer/);
		assert.match(source, /BladeIA Context Analyzer/);
	});

	it('uses a neutral Inbox fallback when sender branding is unavailable', async () => {
		const source = await readSource('../../frontend/src/pages/InboxPage.jsx');

		assert.doesNotMatch(source, /String\(message\.senderName \|\| ''\)\.trim\(\) \|\|\s*['"]Lummine['"]/);
		assert.match(source, /String\(message\.senderName \|\| ''\)\.trim\(\) \|\|\s*['"]Marca['"]/);
	});
});
