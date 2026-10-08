import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
export const captureOutboundDeliveries = (run) => context.run([], run);
export const getOutboundDeliveries = () => [...(context.getStore() || [])];

export async function trackOutboundDelivery(run) {
	try {
		const result = await run();
		context.getStore()?.push({
			status: result?.skipped ? 'SKIPPED'
				: result?.sendResult?.provider === 'ai-lab-simulator' ? 'SIMULATED' : 'ACCEPTED',
			messageId: result?.message?.id || null,
			metaMessageId: result?.message?.metaMessageId || null,
			reason: result?.reason || null,
		});
		return result;
	} catch (error) {
		context.getStore()?.push({
			status: error.code === 'OUTBOUND_OUTCOME_UNKNOWN' ? 'UNKNOWN'
				: error.code === 'OUTBOUND_TURN_CANCELLED' ? 'CANCELLED' : 'FAILED',
			messageId: null, metaMessageId: null, reason: error.code || 'OUTBOUND_FAILED',
		});
		throw error;
	}
}
