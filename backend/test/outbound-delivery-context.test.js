import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureOutboundDeliveries, getOutboundDeliveries, trackOutboundDelivery } from '../src/services/conversation/outbound-delivery-context.js';

test('parallel turns cannot leak delivery IDs across conversations', async () => {
	const results = await Promise.all(['one', 'two'].map(id => captureOutboundDeliveries(async () => {
		await trackOutboundDelivery(async () => { await Promise.resolve(); return { message: { id, body: 'private content' } }; });
		return getOutboundDeliveries();
	})));
	assert.equal(results[0][0].messageId, 'one');
	assert.equal(results[1][0].messageId, 'two');
	assert.equal(JSON.stringify(results).includes('private content'), false);
	assert.deepEqual(getOutboundDeliveries(), []);
});
test('accepted, unknown and cancelled are distinct and errors still propagate', async () => {
	await captureOutboundDeliveries(async () => {
		for (const code of ['OUTBOUND_OUTCOME_UNKNOWN', 'OUTBOUND_TURN_CANCELLED']) {
			await assert.rejects(trackOutboundDelivery(async () => { throw Object.assign(new Error('failure'), { code }); }));
		}
		assert.deepEqual(getOutboundDeliveries().map(row => row.status), ['UNKNOWN', 'CANCELLED']);
	});
});
