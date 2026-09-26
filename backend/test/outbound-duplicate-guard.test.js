import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldSuppressDuplicateAutomaticBody } from '../src/services/conversation/outbound-message.service.js';

test('suppresses the same automatic body inside the short duplicate window', () => {
	const now = Date.parse('2026-09-25T18:00:00.000Z');
	assert.equal(shouldSuppressDuplicateAutomaticBody({
		lastOutbound: { body: 'Te paso el link.', createdAt: '2026-09-25T17:59:30.000Z' },
		body: 'Te paso el link.',
		now,
	}), true);
});

test('does not suppress a different body or an old response', () => {
	const now = Date.parse('2026-09-25T18:00:00.000Z');
	assert.equal(shouldSuppressDuplicateAutomaticBody({
		lastOutbound: { body: 'Te paso el link.', createdAt: '2026-09-25T17:59:30.000Z' },
		body: '¿Qué talle buscás?',
		now,
	}), false);
	assert.equal(shouldSuppressDuplicateAutomaticBody({
		lastOutbound: { body: 'Te paso el link.', createdAt: '2026-09-25T17:57:00.000Z' },
		body: 'Te paso el link.',
		now,
	}), false);
});
