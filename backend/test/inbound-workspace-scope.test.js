import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	getOrCreateConversation,
	processInboundMessage,
} from '../src/services/conversation/chat.service.js';

describe('inbound workspace boundary', () => {
	it('rejects conversation creation without an explicit workspace', async () => {
		await assert.rejects(
			() => getOrCreateConversation({ waId: '5491100000000' }),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});

	it('rejects inbound processing before touching persistence when workspace is absent', async () => {
		await assert.rejects(
			() => processInboundMessage({
				waId: '5491100000000',
				messageBody: 'hola',
				transportMode: 'lab',
			}),
			(error) => error?.code === 'WORKSPACE_SCOPE_REQUIRED',
		);
	});
});
