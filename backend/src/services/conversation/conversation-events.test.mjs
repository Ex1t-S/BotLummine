import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	HUMAN_LOCK_MODE,
	isHumanLockActive,
	resolveHumanAutoResumeAt,
	resolveHumanLockMode,
} from './conversation-events.service.js';

describe('conversation human lock policy', () => {
	it('keeps payment and complaint handoffs locked until explicit release', () => {
		assert.equal(
			resolveHumanLockMode({ reason: 'payment_review', currentState: {} }),
			HUMAN_LOCK_MODE.HARD
		);
		assert.equal(
			resolveHumanLockMode({ reason: 'customer_frustration', currentState: {} }),
			HUMAN_LOCK_MODE.HARD
		);
	});

	it('keeps unresolved catalog facts locked until a person reviews them', () => {
		for (const reason of ['stock_unconfirmed', 'promotion_unconfirmed', 'size_data_unconfirmed', 'product_data_unconfirmed']) {
			const mode = resolveHumanLockMode({ reason, currentState: { lastIntent: 'product' } });
			assert.equal(mode, HUMAN_LOCK_MODE.HARD, reason);
			assert.equal(resolveHumanAutoResumeAt({ mode, lockedAt: new Date('2026-10-21T12:00:00Z') }), null, reason);
		}
	});

	it('keeps a manual takeover locked until explicit release, including commercial chats', () => {
		const lockedAt = new Date('2026-08-01T12:00:00.000Z');
		const mode = resolveHumanLockMode({
			reason: 'manual_handoff',
			currentState: { lastIntent: 'product' },
		});

		assert.equal(mode, HUMAN_LOCK_MODE.HARD);
		assert.equal(resolveHumanAutoResumeAt({ mode, lockedAt }), null);
		assert.equal(isHumanLockActive({ needsHuman: true, handoffReason: 'manual_handoff',
			humanLockMode: HUMAN_LOCK_MODE.COMMERCIAL_24H, humanAutoResumeAt: lockedAt,
		}, new Date('2030-01-01')), true);
	});

	it('expires only the commercial lock', () => {
		assert.equal(
			isHumanLockActive({
				needsHuman: true,
				humanLockMode: HUMAN_LOCK_MODE.COMMERCIAL_24H,
				humanAutoResumeAt: '2026-08-01T12:00:00.000Z',
			}, new Date('2026-08-02T12:00:00.000Z')),
			false
		);
		assert.equal(
			isHumanLockActive({
				needsHuman: true,
				humanLockMode: HUMAN_LOCK_MODE.HARD,
			}, new Date('2030-01-01T00:00:00.000Z')),
			true
		);
	});
});
