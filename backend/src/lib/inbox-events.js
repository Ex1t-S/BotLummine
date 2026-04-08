import { EventEmitter } from 'node:events';

const inboxBus = new EventEmitter();
inboxBus.setMaxListeners(200);

export function publishInboxEvent(payload = {}) {
	inboxBus.emit('inbox:update', {
		type: 'inbox:update',
		emittedAt: new Date().toISOString(),
		...payload,
	});
}

export function subscribeInboxEvents(listener) {
	inboxBus.on('inbox:update', listener);

	return () => {
		inboxBus.off('inbox:update', listener);
	};
}