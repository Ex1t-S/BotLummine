import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
	downloadWhatsAppMediaBuffer,
	getWhatsAppMediaMetadata,
	saveInboundWhatsAppMedia,
	uploadWhatsAppMedia,
} from '../src/services/whatsapp/whatsapp-media.service.js';

describe('WhatsApp media workspace boundary', () => {
	it('rejects upload, metadata, download and persistence without an explicit workspace', async () => {
		for (const operation of [
			() => uploadWhatsAppMedia({ filePath: 'missing.bin' }),
			() => getWhatsAppMediaMetadata({ attachmentId: 'media-a' }),
			() => downloadWhatsAppMediaBuffer('https://example.invalid/media'),
			() => saveInboundWhatsAppMedia({ attachmentId: 'media-a' }),
		]) {
			await assert.rejects(
				operation,
				(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
			);
		}
	});

	it('fails closed when a phone channel belongs to another workspace', async () => {
		const source = await readFile(
			new URL('../src/services/whatsapp/whatsapp-media.service.js', import.meta.url),
			'utf8',
		);

		assert.match(source, /WHATSAPP_CHANNEL_WORKSPACE_MISMATCH/);
		assert.match(source, /channelByPhoneNumber\.workspaceId[\s\S]*resolvedWorkspaceId/);
		assert.match(source, /allowEnvironmentFallback\s*=\s*resolvedWorkspaceId\s*===\s*DEFAULT_WORKSPACE_ID/);
		assert.doesNotMatch(source, /workspaceId\s*=\s*DEFAULT_WORKSPACE_ID/);
	});
});
